## Worker Proxy

Worker Proxy is a Cloudflare Workers based proxy server that proxies incoming requests through to downstream servers. It has the following features:

- Supports multiple downstream servers.
  - Downstream servers are chosen based on the URL path of the incoming requests.
  - The first path segment determines the downstream server. The remaining segments are passed through to the downstream server.
- For each downstream server, custom headers can be set, that are sent with each outgoing downstream request.
  - This includes headers like Authorization.
- The downstream servers configuration is stored in Cloudflare Workers KV.
- Each configured downstream server can also be configured to require authn/authz.
  - Auth headers set in incoming requests are compared to the configured auth for the relevant downstream server.

## Quick Start

1. Clone and install dependencies:
```bash
git clone <repository>
cd worker-proxy
bun install
```

2. Configure your KV namespace:
```bash
# Create a KV namespace
wrangler kv:namespace create "PROXY_SERVERS"

# Update wrangler.toml with the returned ID
# Then populate your server configuration
wrangler kv:key put "servers" --namespace-id=YOUR_KV_ID --path=example-kv-config.json
```

3. Test locally:
```bash
bun run dev
```

4. Deploy to Cloudflare:
```bash
bun run deploy
```

## Configuration

The proxy configuration is stored in KV under the `servers` key. Here's an example configuration:

```json
{
  "api": {
    "url": "https://api.example.com",
    "headers": {
      "X-Custom": "value",
      "Authorization": "Bearer static-token"
    },
    "auth": "Bearer required-token"
  },
  "web": {
    "url": "https://web.example.com"
  },
  "images": {
    "url": "https://cdn.example.com",
    "headers": {
      "X-CDN": "true"
    }
  },
  "custom-auth": {
    "url": "https://secure-api.example.com",
    "auth": "secret-api-key-123",
    "authHeader": "X-API-Key"
  }
}
```

### Configuration Schema

Each server configuration supports:

- `url` (required): Base URL of the downstream server (must be HTTPS)
- `headers` (optional): Custom headers to add to outgoing requests
- `auth` (optional): Required authentication header value for incoming requests
- `authHeader` (optional): Custom header name for authentication (defaults to `Authorization`)

### Request Routing

- Request to `/api/users/123` → routes to `api` server → `https://api.example.com/users/123`
- Request to `/web/dashboard` → routes to `web` server → `https://web.example.com/dashboard`
- Request to `/images/photo.jpg` → routes to `images` server → `https://cdn.example.com/photo.jpg`

### Header Forwarding

The proxy forwards headers as follows:

- **All incoming headers** are passed to the downstream server **except** the authentication header
  - Default: `Authorization` header is not forwarded
  - Custom: If `authHeader` is configured, that header is not forwarded instead
- **Configured headers** are added only if they don't already exist in the incoming request
  - Incoming headers take priority over configured headers
  - This allows clients to override default headers when needed

**Example:**
```json
{
  "api": {
    "url": "https://api.example.com",
    "headers": { "X-Default": "config-value" },
    "auth": "Bearer token123"
  }
}
```

- Request with `X-Default: client-value` → downstream receives `X-Default: client-value` (client wins)
- Request without `X-Default` → downstream receives `X-Default: config-value` (config provides default)
- `Authorization` header is never forwarded to the downstream server

### Authentication

If a server has an `auth` configuration, incoming requests must include a matching authentication header. By default, this is the `Authorization` header:

#### Default Authorization Header
```
Authorization: Bearer required-token
```

#### Custom Authentication Header
You can also specify a custom header name using `authHeader`:

```json
{
  "api": {
    "url": "https://api.example.com",
    "auth": "secret-api-key-123",
    "authHeader": "X-API-Key"
  }
}
```

Then the incoming request must include:
```
X-API-Key: secret-api-key-123
```

If the required header is missing or doesn't match, the proxy returns a 401 Unauthorized response.

## Development

```bash
# Start development server
bun run dev

# Run tests
bun run test

# Type checking
bun run typecheck

# Linting
bun run lint

# Format code
bun run format
```

## Deployment

```bash
# Deploy to production
bun run deploy

# Deploy with specific environment
bun run deploy --env production
```

## Error Handling

- `404 Not Found`: No server configuration found for the requested path
- `401 Unauthorized`: Authentication required but missing or invalid
- `500 Internal Server Error`: Configuration errors or invalid backend URLs
- `502 Bad Gateway`: Backend server is unreachable


