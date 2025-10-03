# Technical Specifications for Worker Proxy

## Overview
Worker Proxy is a Cloudflare Worker that serves as a reverse proxy, routing incoming HTTP requests to one of multiple downstream backend servers. The routing decision is based on the first path segment of the URL. Configuration for downstream servers, including URLs, custom headers, and optional authentication requirements, is stored in Cloudflare KV namespaces.

## Architecture
- **Deployment Environment**: Cloudflare Workers (edge computing platform).
- **Runtime**: TypeScript, compiled to JavaScript for Worker execution.
- **Storage**: Cloudflare KV for storing server configurations.
- **Networking**: Uses the Fetch API for proxying requests to backend servers.
- **Authentication**: Header-based (e.g., Authorization), compared against KV-stored values.

## Key Components
### 1. Request Router
- Parses the incoming request's URL pathname.
- Extracts the first path segment (e.g., for `/api/users/123`, the segment is `api`).
- Uses this segment as a key to retrieve the corresponding server configuration from KV.
- If no configuration found, returns HTTP 404 Not Found.

### 2. Server Configuration
- Stored in KV under a namespace bound to the Worker (e.g., `PROXY_SERVERS`).
- Key structure: A JSON object at key `servers` mapping server keys to configurations, or individual keys like `server:api`.
- Configuration Schema (TypeScript interface):
  ```typescript
  interface ServerConfig {
    url: string; // Base URL of the downstream server (e.g., 'https://api.example.com')
    headers?: Record&lt;string, string&gt;; // Custom headers to add (e.g., { 'Authorization': 'Bearer static-token' })
    auth?: string; // Required Authorization header value for this server (e.g., 'Bearer user-token')
  }
  ```
- Example KV Entry (`servers` key):
  ```json
  {
    &quot;api&quot;: {
      &quot;url&quot;: &quot;https://api.backend.com&quot;,
      &quot;headers&quot;: { &quot;X-Custom&quot;: &quot;value&quot; },
      &quot;auth&quot;: &quot;Bearer required-token&quot;
    },
    &quot;web&quot;: {
      &quot;url&quot;: &quot;https://web.backend.com&quot;
    }
  }
  ```

### 3. Authentication and Authorization
- For servers with `auth` configured:
  - Extracts `Authorization` header from incoming request.
  - Compares it exactly with the configured `auth` value (case-sensitive, no hashing for simplicity).
  - If mismatch or absent, returns HTTP 401 Unauthorized with message &quot;Authentication required&quot;.
- No auth required if not specified in config.

### 4. Request Forwarding
- Constructs backend URL: `config.url + '/' + remainingPath + search` (where `remainingPath` is the original path minus the first segment).
- Preserves original query parameters (`search`).
- Method, body, and non-auth headers are forwarded as-is.
- Adds config `headers` to the outgoing request.
- Forwards the response from backend unchanged (status, headers, body).
- Handles CORS: Adds appropriate headers if needed, but proxies handle this.

### 5. Error Handling
- **KV Errors**: If KV read fails, return HTTP 500 Internal Server Error with &quot;Configuration error&quot;.
- **Fetch Errors**: If backend fetch fails (e.g., network error), return HTTP 502 Bad Gateway.
- **Invalid URLs**: Validate config `url` is HTTPS; log and return 500 if invalid.
- Logging: Use `console.error` for debugging; avoid logging sensitive data like auth tokens.

## Request Handling Flow
1. Receive `fetch(request, env)` event.
2. Parse `request.url` to get pathname and search.
3. Split pathname by `/`, take first non-empty segment as `serverKey`.
4. If no `serverKey` or empty path, return 404.
5. Retrieve config: `await env.KV.get('servers', { type: 'json' })`, then `config = servers[serverKey]`.
6. If no config, return 404 &quot;Server not found&quot;.
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