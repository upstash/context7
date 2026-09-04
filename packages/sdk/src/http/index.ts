import { Context7Error, Context7UrlError } from "@error";
import {
  abortError,
  createAbortState,
  isContext7AbortError,
  resolveSignal,
  validateTimeout,
  wait,
  type AbortState,
} from "./abort";
import { createRetryPolicy, isTransientStatus, retryDelay } from "./retry";
import { extractResponseMetadata, parseSuccessResponse, throwResponseError } from "./response";
import type {
  CacheSetting,
  Context7Fetch,
  Context7Request,
  Context7Response,
  Context7ResponseMetadata,
  HttpClientConfig,
  Requester,
  RetryPolicy,
} from "./types";

export * from "./types";

const DEFAULT_TIMEOUT = 30_000;

type FetchResult = {
  response: Response;
  metadata: Context7ResponseMetadata;
};

export class HttpClient implements Requester {
  public readonly baseUrl: string;
  public readonly headers: Record<string, string>;
  public readonly options: {
    signal?: AbortSignal | (() => AbortSignal);
    cache?: CacheSetting;
    timeout: number | false;
    keepAlive: boolean;
  };
  public readonly retry: RetryPolicy;

  private readonly fetch: Context7Fetch;
  private readonly onResponse?: (metadata: Context7ResponseMetadata) => void;

  public constructor(config: HttpClientConfig) {
    this.options = {
      cache: config.cache,
      signal: config.signal,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      keepAlive: config.keepAlive ?? true,
    };
    validateTimeout(this.options.timeout);

    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    if (!isHttpUrl(this.baseUrl)) throw new Context7UrlError(this.baseUrl);

    this.headers = { "Content-Type": "application/json", ...config.headers };
    if (!config.fetch && !globalThis.fetch) {
      throw new TypeError("A fetch implementation is required");
    }
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.onResponse = config.onResponse;
    this.retry = createRetryPolicy(config.retry);
  }

  public async request<TResult>(request: Context7Request): Promise<Context7Response<TResult>> {
    const method = request.method ?? "POST";
    const abortState = createAbortState(
      [resolveSignal(this.options.signal), request.signal],
      request.timeout ?? this.options.timeout
    );
    const init: RequestInit = {
      cache: normalizeCache(request.cache ?? this.options.cache),
      method,
      headers: this.headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      keepalive: this.options.keepAlive,
      signal: abortState.signal,
    };

    try {
      if (abortState.signal?.aborted) {
        throw abortError(abortState.signal.reason, abortState.timedOut());
      }

      const { response, metadata } = await this.fetchWithRetry(
        buildUrl(this.baseUrl, method, request),
        init,
        method,
        abortState
      );
      if (!response.ok) {
        await throwResponseError(
          response,
          metadata,
          isTransientStatus(response.status) || this.retry.statuses.has(response.status)
        );
      }
      return await parseSuccessResponse<TResult>(response, metadata);
    } catch (error) {
      if (abortState.signal?.aborted && !isContext7AbortError(error)) {
        throw abortError(error, abortState.timedOut());
      }
      throw error;
    } finally {
      abortState.cleanup();
    }
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    method: "GET" | "POST",
    abortState: AbortState
  ): Promise<FetchResult> {
    const canRetry = this.retry.methods.has(method);

    for (let attempt = 0; attempt <= this.retry.attempts; attempt++) {
      let response: Response;
      try {
        response = await this.fetch(url, init);
      } catch (cause) {
        if (abortState.signal?.aborted) {
          throw abortError(cause, abortState.timedOut());
        }
        if (canRetry && attempt < this.retry.attempts) {
          await wait(this.retry.backoff(attempt), abortState.signal);
          continue;
        }
        throw new Context7Error(errorMessage(cause), {
          code: "network_error",
          retryable: true,
          cause,
        });
      }

      const metadata = extractResponseMetadata(response, attempt);
      this.onResponse?.(metadata);
      const shouldRetry =
        canRetry && this.retry.statuses.has(response.status) && attempt < this.retry.attempts;
      if (!shouldRetry) return { response, metadata };

      await response.body?.cancel().catch(() => undefined);
      await wait(
        retryDelay(this.retry.backoff(attempt), metadata.rateLimit?.retryAfter),
        abortState.signal
      );
    }

    throw new Error("Unreachable retry state");
  }
}

function buildUrl(baseUrl: string, method: "GET" | "POST", request: Context7Request): string {
  const url = [baseUrl, ...(request.path ?? [])].join("/");
  if (method !== "GET" || !request.query) return url;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.query)) {
    if (value !== undefined) query.append(key, String(value));
  }
  const queryString = query.toString();
  return queryString ? `${url}?${queryString}` : url;
}

function isHttpUrl(url: string): boolean {
  if (url !== url.trim() || /[\r\n]/.test(url)) return false;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
