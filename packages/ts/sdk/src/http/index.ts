import { Context7Error } from "@error";

type CacheSetting =
  | "default"
  | "force-cache"
  | "no-cache"
  | "no-store"
  | "only-if-cached"
  | "reload"
  | false;

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
       * A backoff function receives the current retry cound and returns a number in milliseconds to wait before retrying.
       *
       * @default
       * ```ts
       * Math.exp(retryCount) * 50
       * ```
       */
      backoff?: (retryCount: number) => number;
    };

export type RequesterConfig = {
  /**
   * Configure the retry behaviour in case of network errors
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
  signal?: () => AbortSignal;
} & RequesterConfig;

export class HttpClient implements Requester {
  public baseUrl: string;
  public headers: Record<string, string>;
  public readonly options: {
    signal?: HttpClientConfig["signal"];
    cache?: CacheSetting;
  };

  public readonly retry: {
    attempts: number;
    backoff: (retryCount: number) => number;
  };

  public constructor(config: HttpClientConfig) {
    this.options = {
      cache: config.cache,
      signal: config.signal,
    };

    this.baseUrl = config.baseUrl.replace(/\/$/, "");

    this.headers = {
      "Content-Type": "application/json",
      ...config.headers,
    };

    this.retry =
      typeof config?.retry === "boolean" && config?.retry === false
        ? {
            attempts: 1,
            backoff: () => 0,
          }
        : {
            attempts: config?.retry?.retries ?? 5,
            backoff: config?.retry?.backoff ?? ((retryCount) => Math.exp(retryCount) * 50),
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

    const requestOptions = {
      cache: this.options.cache,
      method,
      headers: this.headers,
      body: req.body ? JSON.stringify(req.body) : undefined,
      keepalive: true,
      signal: this.options.signal?.(),
    };

    let res: Response | null = null;
    let error: Error | null = null;

    for (let i = 0; i <= this.retry.attempts; i++) {
      try {
        res = await fetch(url, requestOptions as RequestInit);
        break;
      } catch (error_) {
        if (requestOptions.signal?.aborted) {
          throw error_;
        }
        error = error_ as Error;
        if (i < this.retry.attempts) {
          await new Promise((r) => setTimeout(r, this.retry.backoff(i)));
        }
      }
    }
    if (!res) {
      throw error ?? new Error("Exhausted all retries");
    }

    if (!res.ok) {
      const errorBody = (await res.json()) as { error?: string; message?: string };
      throw new Context7Error(errorBody.error || errorBody.message || res.statusText);
    }

    const contentType = res.headers.get("content-type");

    if (contentType?.includes("application/json")) {
      const body = await res.json();
      return { result: body as TResult };
    } else {
      const text = await res.text();
      const headers = this.extractTxtResponseHeaders(res.headers);
      return { result: text as TResult, headers };
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
