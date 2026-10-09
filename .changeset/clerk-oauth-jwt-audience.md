---
"@upstash/context7-mcp": patch
---

Verify OAuth JWT access tokens from the authorization server (Clerk) strictly on the hosted HTTP transport: signature, issuer, a `typ` of `at+jwt`, expiry with a minute of clock tolerance, and the token's `aud`. Clerk ID tokens and session JWTs, which share the issuer, now get HTTP 401. The audience is compared against the `RESOURCE_URL` origin, `/mcp` and `/mcp/oauth` (override with `MCP_OAUTH_ALLOWED_AUDIENCES`); `MCP_OAUTH_AUDIENCE_ENFORCEMENT` defaults to `observe`, which admits a mismatch and logs the OAuth client ID and audience, and `required` answers 401. These JWTs count as `oauth` in authentication telemetry, a token the Context7 API rejects on a tool call is challenged on the next request, and a rejected OAuth token now stays rejected in the per-replica cache for ten minutes instead of thirty seconds.
