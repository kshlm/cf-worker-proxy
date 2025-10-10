# Technical Specifications for Worker Proxy

## Overview
Worker Proxy is a Cloudflare Worker that serves as a reverse proxy, routing incoming HTTP requests to one of multiple downstream backend servers. The routing decision is based on the first path segment of the URL. Configuration for downstream servers, including URLs, custom headers, and optional authentication requirements, is stored in Cloudflare KV namespaces.

## Architecture
- **Deployment Environment**: Cloudflare Workers (edge computing platform).
- **Runtime**: TypeScript, compiled to JavaScript for Worker execution.
- **Storage**: Cloudflare KV for storing server configurations. Cloudflare Secrets for storing sensitive information.
- **Networking**: Uses the Fetch API for proxying requests to backend servers.
- **Authentication**: Header-based (e.g., Authorization), compared against secret-stored values.

## Key Components
### 1. Request Router
- Parses the incoming request's URL pathname.
- Extracts the first path segment (e.g., for `/api/users/123`, the segment is `api`).
- Uses this segment as a key to retrieve the corresponding server configuration from KV.
- If no configuration found, returns HTTP 404 Not Found.

### 2. Server Configuration
 Stored in KV under a namespace bound to the Worker (e.g., `PROXY_SERVERS`).
 Key structure: Individual keys like per configured proxy server, eg. `api`
 Values: `ServerConfig` objects serialized into JSON
  ```typescript
  interface AuthConfig {
    header: string;        // Header name (e.g., "Authorization", "X-API-Key")
    value: string;         // Expected header value
  }

  interface ServerConfig {
    url: string; // Base URL of the downstream server (e.g., 'https://api.example.com')
    headers?: Record<string, string>; // Custom headers to add (e.g., { 'Authorization': 'Bearer ${API_TOKEN}' })

    // Legacy single-header authentication (deprecated for new configs)
    auth?: string; // Required authentication header value for this server (e.g., 'Bearer ${REQUIRED_AUTH}', 'secret-key-123')
    authHeader?: string; // Custom header name for authentication (defaults to 'Authorization') (e.g., 'X-API-Key')

    // New multi-header authentication
    authConfigs?: AuthConfig[]; // Array of authentication configurations supporting multiple valid headers

    Note: Both `auth`, `authConfig.value`, and header values support interpolation using Worker Secrets.
    Use placeholders like `${SECRET_NAME}` which will be replaced with the value from `env.SECRET_NAME` at runtime.
    This allows storing sensitive tokens as Cloudflare Worker Secrets instead of plain text in KV.
  }
  ```

  ```json
  {
    "api": {
      "url": "https://api.backend.com",
      "headers": { "X-Custom": "value", "Authorization": "Bearer ${API_AUTH_TOKEN}" },
      "auth": "Bearer ${REQUIRED_AUTH_TOKEN}"
    },
    "secure-api": {
      "url": "https://secure-api.backend.com",
      "auth": "${SECRET_API_KEY}",
      "authHeader": "X-API-Key"
    },
    "multi-auth-api": {
      "url": "https://flexible-api.backend.com",
      "authConfigs": [
        { "header": "Authorization", "value": "Bearer ${BEARER_TOKEN}" },
        { "header": "X-API-Key", "value": "${API_KEY}" }
      ]
    },
    "web": {
      "url": "https://web.backend.com"
    }
  }
  ```

## 3. Authentication and Authorization

### Legacy Single-Header Authentication
- For servers with legacy `auth` configured:
  - Extracts the authentication header from incoming request:
    - Uses `config.authHeader` if specified (e.g., "X-API-Key")
    - Defaults to "Authorization" header if `authHeader` not specified
  - Compares it exactly with the configured `auth` value (case-sensitive, no hashing for simplicity).
  - If mismatch or absent, returns HTTP 401 Unauthorized with message "Authentication required".

### Multi-Header Authentication
- For servers with `authConfigs` configured:
  - Supports multiple valid authentication headers simultaneously
  - **"Any One Match" Logic**: Access granted if ANY configured auth header matches
    - Check each `AuthConfig` in order
    - Compare request header value exactly with configured `value`
    - If any match succeeds, authentication passes
  - **No Auth Headers Present**:
    - If no auth headers are configured, authentication succeeds

### Backward Compatibility
- Legacy `auth`/`authHeader` configurations continue to work unchanged
- Mixed configurations (legacy + new) are supported:
  - Legacy auth is merged into `authConfigs` if no header name conflict exists
  - `authConfigs` takes precedence when header names conflict

### Error Responses
- Returns HTTP 401 Unauthorized with message "Authentication required" when authentication fails
- Provides detailed error logging for debugging (without exposing sensitive values)
- No auth required if neither `auth` nor `authConfigs` are specified in config.

### Global Authentication
Global authentication provides a master authentication layer that applies across all servers in the proxy. When configured, it creates a two-tier authentication flow that can override per-server authentication rules.

#### Configuration Methods
Global authentication can be configured via:
1. **Environment Variable**: `GLOBAL_AUTH_CONFIGS` (JSON array of AuthConfig objects)
2. **KV Storage**: Key `global-auth-configs` with JSON array value
3. **Fallback Logic**: Environment variable takes priority, KV storage used as fallback

```json
[
  {
    "header": "Authorization",
    "value": "Bearer ${GLOBAL_ADMIN_TOKEN}"
  },
  {
    "header": "X-API-Key", 
    "value": "${MASTER_API_KEY}"
  }
]
```

#### Two-Tier Authentication Flow
1. **Global Auth Check**: System first checks global authentication if configured
2. **Override Behavior**: If global auth succeeds, access is granted immediately (per-server auth skipped)
3. **Fallback Logic**: If global auth fails, system falls back to per-server authentication
4. **Mandatory Auth**: When global auth is configured, some form of authentication is always required

#### Global Auth Scenarios
- **Global Auth Success**: Valid global auth headers grant access regardless of per-server config
- **Global Auth Failure + Per-Server Success**: Falls back to per-server authentication
- **Both Fail**: Returns 401 Unauthorized
- **Global Auth Configured + Server No Auth**: Still requires global auth (no open access)

#### Security Features
- **Header Removal**: Global auth headers are removed before forwarding to downstream services
- **Secret Interpolation**: Supports `${SECRET_NAME}` pattern in global auth values
- **Same Security**: Provides identical security guarantees as per-server authentication
- **Error Handling**: Malformed global auth config returns 500 Internal Server Error

#### Performance Considerations
- **Early Exit**: Global auth success skips per-server auth processing
- **Configuration Caching**: Global auth config is cached to avoid repeated parsing
- **Minimal Overhead**: Adds only one authentication check when global auth is disabled

### 4. Request Forwarding
- Constructs backend URL: `config.url + '/' + remainingPath + search` (where `remainingPath` is the original path minus the first segment).
- Preserves original query parameters (`search`).
- Method and body are forwarded as-is.
- All incoming headers are forwarded downstream **except** the authentication headers:
  - **Legacy**: If `authHeader` is configured, that header is excluded (e.g., "X-API-Key")
  - **Legacy**: If not configured, the "Authorization" header is excluded
  - **Multi-Auth**: All headers configured in `authConfigs` are excluded for security
  - **Mixed**: All configured headers from both legacy and new authentication methods are excluded
- Configured headers are added only if they don't already exist in the incoming request
  - Incoming headers take priority over configured headers
  - Interpolates any secrets in the config `headers`
- Forwards the response from backend unchanged (status, headers, body).
- Handles CORS: Adds appropriate headers if needed, but proxies handle this.

### 5. Error Handling
- **KV Errors**: If KV read fails, return HTTP 500 Internal Server Error with "Configuration error".
- **Fetch Errors**: If backend fetch fails (e.g., network error), return HTTP 502 Bad Gateway.
- **Invalid URLs**: Validate config `url` is HTTPS; log and return 500 if invalid.
- Logging: Use `console.error` for debugging; avoid logging sensitive data like auth tokens.

## Request Handling Flow
1. Receive `fetch(request, env)` event.
2. Parse `request.url` to get pathname and search.
3. Split pathname by `/`, take first non-empty segment as `serverKey`.
4. If no `serverKey` or empty path, return 404.
5. Retrieve config: `await env.KV.get('servers', { type: 'json' })`, then `config = servers[serverKey]`.
6. If no config, return 404 "Server not found".
7. **Two-Tier Authentication Check**:
   - **Global Authentication**: Load global auth config (environment variable `GLOBAL_AUTH_CONFIGS` or KV key `global-auth-configs`)
   - If global auth configured and request headers match any global auth config, grant access immediately (skip to step 8)
   - **Per-Server Authentication**: If global auth fails or not configured, proceed with server-specific auth
   - Merge legacy `auth`/`authHeader` with `authConfigs` (if present) to create unified auth array
   - If no authentication configured and no global auth configured, skip to step 8
   - Check for valid matches: if ANY configured header matches request header value, authentication passes
   - If global auth is configured but both global and per-server auth fail, return 401 "Authentication required"
8. Build backend URL: `${config.url}/${pathname.slice(serverKey.length + 1)}${search}`.
9. Clone request, set `url` to backend URL, add `config.headers`.
10. Remove all authentication headers (both global and per-server) from the cloned request for security.
11. `response = await fetch(modifiedRequest)`.
12. Return `response`.

## Non-Functional Requirements
- **Performance**: Sub-100ms latency target; leverage Workers' global edge network.
- **Scalability**: Serverless; auto-scales with traffic.
- **Security**: 
  - Validate all inputs (paths, URLs).
  - Never expose KV contents or internal errors to responses.
  - Use HTTPS for all backend URLs.
  - Rate limiting: Not implemented initially; consider Workers limits.
- **Observability**: Integrate with Cloudflare Logs/Analytics for monitoring.
- **Testing**: Unit tests for router, auth, forwarding; integration tests simulating KV and fetch.

## Dependencies
- Cloudflare Workers Runtime APIs: `fetch`, KV bindings.
- No external npm packages; use built-in TypeScript types.
- Development: Wrangler CLI for deployment, Vitest for testing.
