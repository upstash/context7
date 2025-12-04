# OAuth Redis Schema

All OAuth data stored in Upstash Redis with appropriate TTLs.

## Key Patterns

### 1. OAuth Clients (Dynamic Registration)

```
Key:     oauth:client:{client_id}
Type:    Hash
TTL:     No expiry (persistent) or 1 year
Fields:
  - client_name: string
  - client_uri: string
  - redirect_uris: JSON array string
  - grant_types: JSON array string
  - created_at: ISO timestamp
```

Example:
```
HSET oauth:client:550e8400-e29b-41d4-a716-446655440000
  client_name "Cursor"
  client_uri "https://cursor.com"
  redirect_uris '["http://127.0.0.1:8080/callback"]'
  grant_types '["authorization_code"]'
  created_at "2025-12-04T10:00:00Z"
```

### 2. Authorization Codes (Short-lived)

```
Key:     oauth:code:{code}
Type:    Hash
TTL:     600 seconds (10 minutes)
Fields:
  - client_id: string
  - user_id: string (Clerk ID)
  - redirect_uri: string
  - code_challenge: string (PKCE S256)
  - scope: string
  - resource: string (optional)
  - state: string (optional)
  - created_at: ISO timestamp
```

Example:
```
HSET oauth:code:SplxlOBeZQQYbYS6WxSbIA
  client_id "550e8400-e29b-41d4-a716-446655440000"
  user_id "user_2abc123"
  redirect_uri "http://127.0.0.1:8080/callback"
  code_challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
  scope "mcp:read"
  created_at "2025-12-04T10:00:00Z"
EXPIRE oauth:code:SplxlOBeZQQYbYS6WxSbIA 600
```

### 3. Refresh Tokens

```
Key:     oauth:refresh:{token_hash}
Type:    Hash
TTL:     2592000 seconds (30 days)
Fields:
  - user_id: string
  - client_id: string
  - project_id: string
  - scope: string
  - created_at: ISO timestamp
  - last_used_at: ISO timestamp
```

Additionally, maintain a set of refresh tokens per user for revocation:
```
Key:     oauth:user_tokens:{user_id}
Type:    Set
TTL:     No expiry (cleaned up when tokens expire)
Members: token_hash values
```

Example:
```
HSET oauth:refresh:a1b2c3d4e5f6...
  user_id "user_2abc123"
  client_id "550e8400-e29b-41d4-a716-446655440000"
  project_id "proj_xyz"
  scope "mcp:read"
  created_at "2025-12-04T10:00:00Z"
  last_used_at "2025-12-04T10:00:00Z"
EXPIRE oauth:refresh:a1b2c3d4e5f6... 2592000

SADD oauth:user_tokens:user_2abc123 "a1b2c3d4e5f6..."
```

### 4. Revoked JWTs (for immediate revocation)

```
Key:     oauth:revoked:{jti}
Type:    String
TTL:     Same as JWT expiry (3 hours max)
Value:   "1" or timestamp
```

Example:
```
SET oauth:revoked:jwt-unique-id "1"
EXPIRE oauth:revoked:jwt-unique-id 10800
```

### 5. JWT Validation Cache

```
Key:     oauth:jwt_cache:{token_hash_suffix}
Type:    Hash
TTL:     300 seconds (5 minutes)
Fields:
  - sub: user_id
  - project_id: string
  - scope: string
  - client_id: string
  - exp: expiration timestamp
```

### 6. Usage Tracking

```
Key:     usage:{project_id}:{date}
Type:    String (counter)
TTL:     172800 seconds (48 hours)
Value:   Integer count
```

Example:
```
INCR usage:proj_xyz:2025-12-04
EXPIRE usage:proj_xyz:2025-12-04 172800
```

### 7. Rate Limiting

```
Key:     ratelimit:{project_id}:{window}
Type:    String (counter)
TTL:     Window duration (e.g., 60 seconds for per-minute)
Value:   Integer count
```

## Operations Summary

| Operation | Redis Command | TTL |
|-----------|---------------|-----|
| Register client | HSET + (optional EXPIRE) | Persistent or 1 year |
| Store auth code | HSET + EXPIRE | 10 minutes |
| Consume auth code | DEL | - |
| Store refresh token | HSET + EXPIRE + SADD | 30 days |
| Validate refresh token | HGETALL | - |
| Revoke refresh token | DEL + SREM | - |
| Revoke all user tokens | SMEMBERS + DEL | - |
| Revoke JWT | SET + EXPIRE | 3 hours |
| Check JWT revoked | GET | - |
| Cache JWT validation | HSET + EXPIRE | 5 minutes |
| Track usage | INCR + EXPIRE | 48 hours |
| Check rate limit | INCR + EXPIRE | Window duration |

## Cleanup

Redis TTLs handle most cleanup automatically. For user token sets:

```lua
-- Periodic cleanup script (optional)
-- Remove expired token hashes from user sets
local user_keys = redis.call('KEYS', 'oauth:user_tokens:*')
for _, user_key in ipairs(user_keys) do
  local tokens = redis.call('SMEMBERS', user_key)
  for _, token_hash in ipairs(tokens) do
    if redis.call('EXISTS', 'oauth:refresh:' .. token_hash) == 0 then
      redis.call('SREM', user_key, token_hash)
    end
  end
end
```
