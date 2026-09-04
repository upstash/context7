import { Context7Error, Context7JSONParseError } from "@error";
import type {
  Context7Response,
  Context7ResponseMetadata,
  RateLimitMetadata,
  TxtResponseHeaders,
} from "./types";

export function extractResponseMetadata(
  response: Response,
  attempt: number
): Context7ResponseMetadata {
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

export async function parseSuccessResponse<TResult>(
  response: Response,
  metadata: Context7ResponseMetadata
): Promise<Context7Response<TResult>> {
  if (response.headers.get("content-type")?.includes("application/json")) {
    return { result: (await parseJson(response, metadata)) as TResult };
  }

  return {
    result: (await response.text()) as TResult,
    headers: extractTxtResponseHeaders(response.headers),
  };
}

export async function throwResponseError(
  response: Response,
  metadata: Context7ResponseMetadata,
  retryable: boolean
): Promise<never> {
  const rawBody = await response.text();
  let errorBody: { error?: string; message?: string } = {};

  if (rawBody) {
    try {
      errorBody = JSON.parse(rawBody) as typeof errorBody;
    } catch (cause) {
      if (response.headers.get("content-type")?.includes("application/json")) {
        throw jsonParseError(rawBody, metadata, cause, retryable);
      }
    }
  }

  throw new Context7Error(errorBody.message || errorBody.error || response.statusText, {
    code: errorBody.error ?? "http_error",
    status: response.status,
    requestId: metadata.requestId,
    rateLimit: metadata.rateLimit,
    retryable,
  });
}

async function parseJson(response: Response, metadata: Context7ResponseMetadata): Promise<unknown> {
  const rawBody = await response.text();
  try {
    return JSON.parse(rawBody);
  } catch (cause) {
    throw jsonParseError(rawBody, metadata, cause, false);
  }
}

function jsonParseError(
  body: string,
  metadata: Context7ResponseMetadata,
  cause: unknown,
  retryable: boolean
): Context7JSONParseError {
  return new Context7JSONParseError(body, {
    status: metadata.status,
    requestId: metadata.requestId,
    rateLimit: metadata.rateLimit,
    retryable,
    cause,
  });
}

function extractTxtResponseHeaders(headers: Headers): TxtResponseHeaders | undefined {
  const page = headers.get("x-context7-page");
  const limit = headers.get("x-context7-limit");
  const totalPages = headers.get("x-context7-total-pages");
  const hasNext = headers.get("x-context7-has-next");
  const hasPrev = headers.get("x-context7-has-prev");
  const totalTokens = headers.get("x-context7-total-tokens");

  if (!page || !limit || !totalPages || !hasNext || !hasPrev || !totalTokens) return undefined;

  return {
    page: Number.parseInt(page, 10),
    limit: Number.parseInt(limit, 10),
    totalPages: Number.parseInt(totalPages, 10),
    hasNext: hasNext === "true",
    hasPrev: hasPrev === "true",
    totalTokens: Number.parseInt(totalTokens, 10),
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
