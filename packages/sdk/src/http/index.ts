import { Context7Error, Context7JSONParseError, Context7UrlError } from "@error";

export type CacheSetting =
  | "default"
  | "force-cache"
  | "no-cache"
  | "no-store"
  | "only-if-cached"
  | "reload"
  | false;

export type Context7Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type RateLimitMetadata = {
  limit?: number;
  remaining?: number;
  reset?: number;
  retryAfter?: number;
};

export type Context7ResponseMetadata = {
  status: number;
  requestId?: string;
  rateLimit?: RateLimitMetadata;
  /** Zero-based retry attempt. The first request is attempt 0. */
  attempt: number;
};

export type Context7Request = {
  path?: string[];
  /**
   * Request body will be serialized to json
   */
  body?: unknown;
  /**
   * HTTP method to use
   * @default "POST"
   */
  method?: "GET" | "POST";
  /**
   * Query parameters for GET requests
   */
  query?: Record<string, string | number | boolean | undefined>;
  /** Abort this request. */
  signal?: AbortSignal;
  /** Override the client timeout for this request. Set to false to disable it. */
  timeout?: number | false;
  /** Override the native fetch cache mode for this request. */
  cache?: CacheSetting;
};
export type TxtResponseHeaders = {
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  totalTokens: number;
};

export type Context7Response<TResult> = {
  result?: TResult;
  headers?: TxtResponseHeaders;
};

export type Requester = {
  request: <TResult = unknown>(req: Context7Request) => Promise<Context7Response<TResult>>;
};

export type RetryConfig =
  | false
  | {
      /**
       * The number of retries to attempt before giving up.
       *
       * @default 5
       */
      retries?: number;
      /**
       * A backoff function receives the current retry count and returns a number in milliseconds to wait before retrying.
       *
       * @default
       * ```ts
       * Math.exp(retryCount) * 50
       * ```
       */
      backoff?: (retryCount: number) => number;
      /** HTTP statuses that may be retried. */
      statuses?: number[];
      /** HTTP methods that may be retried. @default ["GET"] */
      methods?: Array<"GET" | "POST">;
    };

export type RequesterConfig = {
  /**
   * Configure retries for network errors and transient HTTP responses.
   */
  retry?: RetryConfig;

  /**
   * Configure the cache behaviour
   * @default "no-store"
   */
  cache?: CacheSetting;
};

export type HttpClientConfig = {
  headers?: Record<string, string>;
  baseUrl: string;
  retry?: RetryConfig;
  signal?: AbortSignal | (() => AbortSignal);
  timeout?: number | false;
  /** Whether fetch may keep the connection alive. @default true */
  keepAlive?: boolean;
  fetch?: Context7Fetch;
  onResponse?: (metadata: Context7ResponseMetadata) => void;
} & RequesterConfig;

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];

type AbortState = {
  signal?: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
};

export class HttpClient implements Requester {
  public baseUrl: string;
  public headers: Record<string, string>;
  public readonly options: {
    signal?: AbortSignal | (() => AbortSignal);
    cache?: CacheSetting;
    timeout: number | false;
    keepAlive: boolean;
  };

  private readonly fetch: Context7Fetch;
  private readonly onResponse?: (metadata: Context7ResponseMetadata) => void;

  public readonly retry: {
    attempts: number;
    backoff: (retryCount: number) => number;
    statuses: Set<number>;
    methods: Set<"GET" | "POST">;
  };

  public constructor(config: HttpClientConfig) {
    this.options = {
      cache: config.cache,
      signal: config.signal,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      keepAlive: config.keepAlive ?? true,
    };

    validateTimeout(this.options.timeout);

    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    if (!isHttpUrl(this.baseUrl)) {
      throw new Context7UrlError(this.baseUrl);
    }

    this.headers = {
      "Content-Type": "application/json",
      ...config.headers,
    };

    if (!config.fetch && !globalThis.fetch) {
      throw new TypeError("A fetch implementation is required");
    }
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.onResponse = config.onResponse;

    const attempts = config.retry === false ? 0 : (config.retry?.retries ?? 5);
    if (!Number.isInteger(attempts) || attempts < 0) {
      throw new TypeError("retry.retries must be a non-negative integer");
    }

    this.retry =
      config.retry === false
        ? {
            attempts: 0,
            backoff: () => 0,
            statuses: new Set(),
            methods: new Set(),
          }
        : {
            attempts,
            backoff: config?.retry?.backoff ?? ((retryCount) => Math.exp(retryCount) * 50),
            statuses: new Set(config?.retry?.statuses ?? DEFAULT_RETRY_STATUSES),
            methods: new Set(config?.retry?.methods ?? ["GET"]),
          };
  }

  public async request<TResult>(req: Context7Request): Promise<Context7Response<TResult>> {
    const method = req.method || "POST";

    let url = [this.baseUrl, ...(req.path ?? [])].join("/");
    if (method === "GET" && req.query) {
      const queryParams = new URLSearchParams();
      Object.entries(req.query).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, String(value));
        }
      });
      const queryString = queryParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    const abortState = createAbortState({
      signals: [resolveSignal(this.options.signal), req.signal],
      timeout: req.timeout ?? this.options.timeout,
    });

    const requestOptions = {
      cache: normalizeCache(req.cache ?? this.options.cache),
      method,
      headers: this.headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      keepalive: this.options.keepAlive,
      signal: abortState.signal,
    };

    let res: Response | null = null;
    let error: Error | null = null;
    let responseMetadata: Context7ResponseMetadata | undefined;
    const canRetry = this.retry.methods.has(method);

    try {
      if (abortState.signal?.aborted) {
        throw abortError(abortState.signal.reason, abortState.timedOut());
      }

      for (let i = 0; i <= this.retry.attempts; i++) {
        res = null;
        try {
          res = await this.fetch(url, requestOptions as RequestInit);
        } catch (error_) {
          if (abortState.signal?.aborted) {
            throw abortError(error_, abortState.timedOut());
          }
          error = error_ instanceof Error ? error_ : new Error(String(error_));
          if (canRetry && i < this.retry.attempts) {
            await wait(this.retry.backoff(i), abortState.signal);
            continue;
          }
          break;
        }

        responseMetadata = extractResponseMetadata(res, i);
        this.onResponse?.(responseMetadata);

        if (
          res.ok ||
          !canRetry ||
          !this.retry.statuses.has(res.status) ||
          i === this.retry.attempts
        ) {
          break;
        }

        await res.body?.cancel().catch(() => undefined);
        await wait(
          retryDelay(this.retry.backoff(i), responseMetadata.rateLimit?.retryAfter),
          abortState.signal
        );
      }

      if (!res) {
        throw new Context7Error(error?.message ?? "Exhausted all retries", {
          code: "network_error",
          retryable: true,
          cause: error,
        });
      }

      if (!res.ok) {
        let errorBody: {
          error?: string;
          message?: string;
        } = {};
        const rawBody = await res.text();
        if (rawBody) {
          try {
            errorBody = JSON.parse(rawBody) as typeof errorBody;
          } catch (error_) {
            if (abortState.signal?.aborted) throw error_;
            if (res.headers.get("content-type")?.includes("application/json")) {
              throw new Context7JSONParseError(rawBody, {
                status: res.status,
                requestId: responseMetadata?.requestId,
                rateLimit: responseMetadata?.rateLimit,
                retryable:
                  DEFAULT_RETRY_STATUSES.includes(res.status) ||
                  this.retry.statuses.has(res.status),
                cause: error_,
              });
            }
          }
        }
        throw new Context7Error(errorBody.message || errorBody.error || res.statusText, {
          code: errorBody.error ?? "http_error",
          status: res.status,
          requestId: responseMetadata?.requestId,
          rateLimit: responseMetadata?.rateLimit,
          retryable:
            DEFAULT_RETRY_STATUSES.includes(res.status) || this.retry.statuses.has(res.status),
        });
      }

      const contentType = res.headers.get("content-type");

      if (contentType?.includes("application/json")) {
        const rawBody = await res.text();
        let body: unknown;
        try {
          body = JSON.parse(rawBody);
        } catch (error_) {
          throw new Context7JSONParseError(rawBody, {
            status: res.status,
            requestId: responseMetadata?.requestId,
            rateLimit: responseMetadata?.rateLimit,
            cause: error_,
          });
        }
        return { result: body as TResult };
      } else {
        const text = await res.text();
        const headers = this.extractTxtResponseHeaders(res.headers);
        return { result: text as TResult, headers };
      }
    } catch (error_) {
      if (
        abortState.signal?.aborted &&
        (!(error_ instanceof Context7Error) ||
          (error_.code !== "request_aborted" && error_.code !== "request_timeout"))
      ) {
        throw abortError(error_, abortState.timedOut());
      }
      throw error_;
    } finally {
      abortState.cleanup();
    }
  }

  private extractTxtResponseHeaders(headers: Headers): TxtResponseHeaders | undefined {
    const page = headers.get("x-context7-page");
    const limit = headers.get("x-context7-limit");
    const totalPages = headers.get("x-context7-total-pages");
    const hasNext = headers.get("x-context7-has-next");
    const hasPrev = headers.get("x-context7-has-prev");
    const totalTokens = headers.get("x-context7-total-tokens");

    if (!page || !limit || !totalPages || !hasNext || !hasPrev || !totalTokens) {
      return undefined;
    }

    return {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: parseInt(totalPages, 10),
      hasNext: hasNext === "true",
      hasPrev: hasPrev === "true",
      totalTokens: parseInt(totalTokens, 10),
    };
  }
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeCache(cache?: CacheSetting): Exclude<CacheSetting, false> | undefined {
  return cache === false ? undefined : cache;
}

function validateTimeout(timeout: number | false): void {
  if (timeout !== false && (!Number.isFinite(timeout) || timeout <= 0)) {
    throw new TypeError("timeout must be a positive number or false");
  }
}

function resolveSignal(signal?: AbortSignal | (() => AbortSignal)): AbortSignal | undefined {
  return typeof signal === "function" ? signal() : signal;
}

function createAbortState({
  signals,
  timeout,
}: {
  signals: Array<AbortSignal | undefined>;
  timeout: number | false;
}): AbortState {
  validateTimeout(timeout);

  const activeSignals = [
    ...new Set(signals.filter((signal): signal is AbortSignal => signal !== undefined)),
  ];
  if (timeout === false && activeSignals.length === 0) {
    return { timedOut: () => false, cleanup: () => undefined };
  }

  const controller = new AbortController();
  let didTimeOut = false;
  const listeners = new Map<AbortSignal, () => void>();

  for (const signal of activeSignals) {
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
    listeners.set(signal, abort);
  }

  const timer =
    timeout === false
      ? undefined
      : setTimeout(() => {
          didTimeOut = true;
          controller.abort(new Error(`Request timed out after ${timeout}ms`));
        }, timeout);

  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    cleanup: () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const [signal, listener] of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
  };
}

function abortError(cause: unknown, timedOut: boolean): Context7Error {
  return new Context7Error(timedOut ? "Request timed out" : "Request was aborted", {
    code: timedOut ? "request_timeout" : "request_aborted",
    retryable: timedOut,
    cause,
  });
}

function retryDelay(backoff: number, retryAfter?: number): number {
  return Math.max(backoff, retryAfter === undefined ? 0 : retryAfter * 1000);
}

async function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(abortError(signal?.reason, false));
    };

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function extractResponseMetadata(response: Response, attempt: number): Context7ResponseMetadata {
  const rateLimit: RateLimitMetadata = {
    limit: parseOptionalNumber(
      response.headers.get("ratelimit-limit") ?? response.headers.get("x-ratelimit-limit")
    ),
    remaining: parseOptionalNumber(
      response.headers.get("ratelimit-remaining") ?? response.headers.get("x-ratelimit-remaining")
    ),
    reset: parseOptionalNumber(
      response.headers.get("ratelimit-reset") ?? response.headers.get("x-ratelimit-reset")
    ),
    retryAfter: parseRetryAfter(response.headers.get("retry-after")),
  };

  return {
    status: response.status,
    requestId:
      response.headers.get("x-request-id") ??
      response.headers.get("x-context7-request-id") ??
      undefined,
    rateLimit: Object.values(rateLimit).some((value) => value !== undefined)
      ? rateLimit
      : undefined,
    attempt,
  };
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);

  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}
