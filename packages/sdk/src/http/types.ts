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
  /** Request body will be serialized to JSON. */
  body?: unknown;
  /** @default "POST" */
  method?: "GET" | "POST";
  /** Query parameters for GET requests. */
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
      /** @default 5 */
      retries?: number;
      /**
       * Receives the zero-based retry count and returns milliseconds to wait.
       * @default Math.exp(retryCount) * 50
       */
      backoff?: (retryCount: number) => number;
      /** HTTP statuses that may be retried. */
      statuses?: number[];
      /** @default ["GET"] */
      methods?: Array<"GET" | "POST">;
    };

export type RequesterConfig = {
  /** Configure retries for network errors and transient HTTP responses. */
  retry?: RetryConfig;
  /** @default "no-store" */
  cache?: CacheSetting;
};

export type HttpClientConfig = {
  headers?: Record<string, string>;
  baseUrl: string;
  signal?: AbortSignal | (() => AbortSignal);
  timeout?: number | false;
  /** @default true */
  keepAlive?: boolean;
  fetch?: Context7Fetch;
  onResponse?: (metadata: Context7ResponseMetadata) => void;
} & RequesterConfig;

export type RetryPolicy = {
  attempts: number;
  backoff: (retryCount: number) => number;
  statuses: ReadonlySet<number>;
  methods: ReadonlySet<"GET" | "POST">;
};
