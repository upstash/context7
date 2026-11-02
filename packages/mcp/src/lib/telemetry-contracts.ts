import type { McpHttpRoute } from "./mcp-route.js";

export type UpstreamOperation =
  "auth_check" | "fetch_context" | "oauth_metadata" | "search_libraries" | "submit_feedback";
// `expired`: an OAuth token was rejected (the Context7 API refused an opaque
// token, or a Clerk OAuth JWT had expired), so the client was challenged to
// refresh. `unverified`: the token check was unavailable and the request was
// forwarded unchecked (fail open).
export type AuthenticationOutcome =
  "accepted" | "error" | "expired" | "invalid" | "missing" | "unverified";
export type AuthenticationMethod = "api_key" | "jwt" | "none" | "oauth";
// How the OAuth client got its client_id. `cimd`: a Client ID Metadata
// Document URL. `registered`: an opaque Clerk client ID, from Dynamic Client
// Registration or a client pre-registered in Clerk. `unknown`: an opaque `oat_`
// token or a JWT without a `client_id` claim.
export type OAuthClientRegistration = "cimd" | "registered" | "unknown";
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
  AuthenticationDecisionEvent | AuthenticationLifecycleEvent | "metadata_requested";
export type AuthenticationEnforcementMode = "observe" | "required";
export type UpstreamOutcome =
  "cancelled" | "http_error" | "network_error" | "response_error" | "success" | "timeout";

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
  /** Set only for OAuth credentials. */
  oauthClientRegistration?: OAuthClientRegistration;
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
