export type UpstreamOperation = "fetch_context" | "oauth_metadata" | "search_libraries";
export type AuthenticationOutcome = "accepted" | "error" | "invalid" | "missing";
export type UpstreamOutcome =
  | "cancelled"
  | "http_error"
  | "network_error"
  | "response_error"
  | "success"
  | "timeout";

export interface ObservedAuthentication<T> {
  outcome: AuthenticationOutcome;
  value: T;
}

export interface UpstreamObservationOptions {
  abortSignal?: AbortSignal;
}
