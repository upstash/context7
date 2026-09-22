export type UpstreamOperation = "fetch_context" | "oauth_metadata" | "search_libraries";
export type AuthenticationOutcome = "accepted" | "error" | "invalid" | "missing";
export type AuthenticationMethod = "api_key" | "jwt" | "none" | "oauth";
export type AuthenticationEvent =
  | "authenticated_initialize_failed"
  | "authenticated_initialize_succeeded"
  | "authenticated_tool_call"
  | "challenge_issued"
  | "credential_missing"
  | "credential_present"
  | "credential_rejected"
  | "credential_validated"
  | "metadata_requested";
export type AuthenticationEnforcementMode = "observe" | "required";
export type AuthenticationRoute = "anonymous" | "oauth";
export type UpstreamOutcome =
  | "cancelled"
  | "http_error"
  | "network_error"
  | "response_error"
  | "success"
  | "timeout";

export interface ObservedAuthentication<T> {
  event: AuthenticationEvent;
  method: AuthenticationMethod;
  outcome: AuthenticationOutcome;
  value: T;
}

export interface AuthenticationObservationOptions {
  enforcementMode: AuthenticationEnforcementMode;
  route: AuthenticationRoute;
}

export interface AuthenticationEventObservation extends AuthenticationObservationOptions {
  event: AuthenticationEvent;
  method: AuthenticationMethod;
  outcome?: AuthenticationOutcome;
}

export interface UpstreamObservationOptions {
  abortSignal?: AbortSignal;
}
