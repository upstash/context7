import type { McpHttpRoute } from "./mcp-route.js";

export type UpstreamOperation = "fetch_context" | "oauth_metadata" | "search_libraries";
export type AuthenticationOutcome = "accepted" | "error" | "invalid" | "missing";
export type AuthenticationMethod = "api_key" | "jwt" | "none" | "oauth";
export type AuthenticationDecisionEvent =
  | "challenge_issued"
  | "credential_missing"
  | "credential_present"
  | "credential_rejected"
  | "credential_validated";
export type AuthenticationLifecycleEvent =
  | "authenticated_tool_call"
  | "credentialed_initialize_failed"
  | "credentialed_initialize_succeeded";
export type AuthenticationEvent =
  | AuthenticationDecisionEvent
  | AuthenticationLifecycleEvent
  | "metadata_requested";
export type AuthenticationEnforcementMode = "observe" | "required";
export type UpstreamOutcome =
  | "cancelled"
  | "http_error"
  | "network_error"
  | "response_error"
  | "success"
  | "timeout";

export interface AuthenticationObservation {
  event: AuthenticationDecisionEvent;
  method: AuthenticationMethod;
  outcome: AuthenticationOutcome;
}

export interface AuthenticationObservationOptions {
  enforcementMode: AuthenticationEnforcementMode;
  route: McpHttpRoute;
}

interface AuthenticationEventDimensions extends AuthenticationObservationOptions {
  method: AuthenticationMethod;
}

export type AuthenticationEventObservation =
  | (AuthenticationEventDimensions & {
      event: "metadata_requested";
      outcome?: never;
    })
  | (AuthenticationEventDimensions & {
      event: Exclude<AuthenticationEvent, "metadata_requested">;
      outcome: AuthenticationOutcome;
    });

export interface UpstreamObservationOptions {
  abortSignal?: AbortSignal;
}
