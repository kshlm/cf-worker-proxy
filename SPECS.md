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
  interface ServerConfig {
    url: string; // Base URL of the downstream server (e.g., 'https://api.example.com')
    headers?: Record<string, string>; // Custom headers to add (e.g., { 'Authorization': 'Bearer ${API_TOKEN}' })
    auth?: string; // Required Authorization header value for this server (e.g., 'Bearer ${REQUIRED_AUTH}')
    
    Note: Both `auth` and header values support interpolation using Worker Secrets.
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
    "web": {
      "url": "https://web.backend.com"
    }
  }
  ```

## 3. Authentication and Authorization
- For servers with `auth` configured:
  - Extracts `Authorization` header from incoming request.
  - Compares it exactly with the configured `auth` value (case-sensitive, no hashing for simplicity).
  - If mismatch or absent, returns HTTP 401 Unauthorized with message "Authentication required".
   - No auth required if not specified in config.

### 4. Request Forwarding
- Constructs backend URL: `config.url + '/' + remainingPath + search` (where `remainingPath` is the original path minus the first segment).
- Preserves original query parameters (`search`).
- Method, body, and non-auth headers are forwarded as-is.
- Adds config `headers` to the outgoing request.
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
7. Auth check: If `config.auth`, compare `request.headers.get('Authorization')` === `config.auth`; else 401.
8. Build backend URL: `${config.url}/${pathname.slice(serverKey.length + 1)}${search}`.
9. Clone request, set `url` to backend URL, add `config.headers`.
10. `response = await fetch(modifiedRequest)`.
11. Return `response`.

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
