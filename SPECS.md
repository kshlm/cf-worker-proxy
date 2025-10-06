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
    required?: boolean;    // Whether this header is required (defaults to false)
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
        { "header": "X-API-Key", "value": "${API_KEY}" },
        { "header": "X-Service-Token", "value": "${SERVICE_TOKEN}", "required": true }
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
  - **Required Headers**:
    - When `required: true`, that specific header must be present and match
    - If any required header is missing, authentication fails immediately
  - **Optional Headers**:
    - When `required: false` (default), the header is optional
    - Missing optional headers don't cause authentication failure
  - **No Auth Headers Present**:
    - If all headers are optional and none are present, authentication succeeds
    - If any headers are required and missing, authentication fails

### Backward Compatibility
- Legacy `auth`/`authHeader` configurations continue to work unchanged
- Mixed configurations (legacy + new) are supported:
  - Legacy auth is merged into `authConfigs` if no header name conflict exists
  - `authConfigs` takes precedence when header names conflict
- Legacy auth is required by default when no `authConfigs` present
- Legacy auth becomes optional when mixed with `authConfigs`

### Error Responses
- Returns HTTP 401 Unauthorized with message "Authentication required" when authentication fails
- Provides detailed error logging for debugging (without exposing sensitive values)
- No auth required if neither `auth` nor `authConfigs` are specified in config.

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
7. **Authentication Check**:
   - Merge legacy `auth`/`authHeader` with `authConfigs` (if present) to create unified auth array
   - If no authentication configured, skip to step 8
   - Check for required headers: if any `required: true` header is missing, return 401
   - Check for valid matches: if ANY configured header matches request header value, authentication passes
   - If no matches and all headers are optional with none present, authentication passes
   - Otherwise, return 401 "Authentication required"
8. Build backend URL: `${config.url}/${pathname.slice(serverKey.length + 1)}${search}`.
9. Clone request, set `url` to backend URL, add `config.headers`.
10. Remove all authentication headers from the cloned request for security.
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
