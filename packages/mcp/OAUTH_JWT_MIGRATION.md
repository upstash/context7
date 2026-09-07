# MCP OAuth JWT migration

This runbook migrates Context7's Clerk-issued OAuth **access tokens** from opaque values to
locally verifiable JWTs. OIDC ID tokens identify a login session and must not be sent to the
MCP resource server as bearer credentials.

The `/mcp/oauth` endpoint accepts only signed JWT access tokens after this change. The anonymous
`/mcp` endpoint and its existing API-key behavior are unchanged.

## Security contract

The resource server verifies all of the following before handling an MCP request:

- signature from the configured OAuth JWKS;
- exact issuer (`OAUTH_AUTH_SERVER_URL`);
- exact MCP resource audience (`OAUTH_ACCESS_TOKEN_AUDIENCE`, defaulting to `RESOURCE_URL`);
- `RS256` signing algorithm;
- `sub`, `iat`, and `exp` claims; and
- every scope in `OAUTH_REQUIRED_SCOPES` (default: `profile email`).

Requiring access-token scopes also prevents a similarly signed OIDC ID token from being accepted
as an API credential. Opaque tokens are deliberately not introspected by this server and receive
`401`; clients must re-authorize to obtain a JWT.

## Clerk prerequisite and deployment gate

In Clerk Dashboard, open **OAuth Applications → Settings** and enable **Generate access tokens as
JWTs**. Clerk documents that new applications use JWT access tokens by default, while existing
applications keep opaque tokens until this setting is enabled.

Before deploying this change, complete an authorization-code flow in staging and inspect a newly
minted access token. It must contain:

```json
{
  "iss": "https://clerk.context7.com",
  "aud": "https://mcp.context7.com",
  "sub": "...",
  "iat": 0,
  "exp": 0,
  "scope": "profile email"
}
```

The timestamps above are illustrative. The issuer, audience, and scopes must match the deployment.

**Do not deploy and do not remove audience validation if Clerk omits or controls `aud` differently.**
The current callback forwards the RFC 8707 `resource` parameter, but Clerk's public documentation
does not guarantee that it maps that value into the JWT audience. If a staging token is not
audience-bound to the MCP resource, either configure the correct audience in Clerk or mint a
Context7 access token through a token-exchange service. Accepting an issuer-only JWT would let a
token minted for another Context7 service be replayed against MCP.

## Rollout

1. Set staging `RESOURCE_URL` and `OAUTH_ACCESS_TOKEN_AUDIENCE` to the canonical MCP resource URL.
2. Enable Clerk JWT access tokens in staging and obtain a fresh token through the full client flow.
3. Verify its signature and required claims, especially `aud` and `scope`, then run the MCP smoke
   tests with that token.
4. Deploy this resource-server change to staging. Confirm opaque tokens return `401`, valid JWTs
   work, wrong-audience JWTs fail, and ID tokens fail.
5. Confirm whether refreshing an existing opaque-token session produces a JWT. If it does not,
   announce a re-authorization window before production rollout.
6. Enable Clerk JWT access tokens in production, deploy this change, and monitor OAuth `401` rates.
   Users holding opaque tokens will need to re-authorize.
7. Keep JWT lifetimes short enough for the revocation tradeoff. Clerk notes that JWT access tokens
   cannot be revoked immediately; an exposed token remains usable until `exp`.

Rollback the application deployment if valid, freshly minted JWT access tokens fail. Do not
rollback by accepting unvalidated opaque strings on `/mcp/oauth`.

## Separate downstream-token work

After authentication, Context7 currently forwards the bearer credential to the Context7 API. If
the MCP server and API are treated as distinct resource servers, replace that hop with a narrowly
scoped internal assertion or service credential. This migration fixes the MCP ingress validation
boundary; it does not declare bearer-token forwarding compliant with the MCP authorization spec.

## References

- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Clerk OAuth access-token formats](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth)
- [Clerk OAuth token verification](https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens)
