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

This project has been wholly coded by AI, with some minor fixes by me. using mainly the excellent GLM 4.6 model by Z.AI with Claude Code.

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
```

3. Set up proxy configuration:

```bash
# Run the interactive configuration script
bun run scripts/update-proxy-config.ts
```

4. Test locally:

```bash
bun run dev
```

5. Deploy to Cloudflare:

```bash
bun run deploy
```

The configuration script will guide you through setting up proxy servers, authentication, and secrets interactively.

## Configuration

The proxy configuration is stored in KV with each server as a separate key. The worker includes an interactive configuration script for easy setup and management.

### Configuration Management Script

Use the included interactive script for managing proxy configurations:

```bash
# Run the configuration script
bun run scripts/update-proxy-config.ts
```

The script provides:

- **Interactive setup**: Guided configuration for new proxy servers
- **Multi-auth support**: Configure multiple authentication headers
- **Secret generation**: Auto-generate secure tokens and save as Cloudflare secrets
- **Validation**: The same runtime validation the worker applies; invalid configs are rejected before any KV write

### Backup and Restore

Back up the KV configuration to a versioned local file, and restore from one.
The package scripts are bare commands; extra arguments go through them directly:

```bash
# Back up to the default backups/ directory (mode 0600, never overwrites)
bun run backup-config

# Back up into a different directory
bun run backup-config /tmp/my-backups

# Preview what a restore would do without writing anything
bun run restore-config backups/proxy-config-backup-XXX.json --dry-run

# Restore (merge by default; interactive confirmation)
bun run restore-config backups/proxy-config-backup-XXX.json

# Restore non-interactively (still prompts for the reserved global-auth-configs key)
bun run restore-config backups/proxy-config-backup-XXX.json --yes

# Restore and delete remote keys not in the backup (--confirm-prune is the
# strong typed confirmation; the reserved global-auth-configs key is never pruned)
bun run restore-config backups/proxy-config-backup-XXX.json --replace --confirm-prune
```

Restore semantics:

- The entire backup is validated with the runtime validator before the first remote write
- Values are stored in KV verbatim; backups preserve raw values in a versioned document
- Failures are reported per key; the process exits nonzero if any key failed
- The `global-auth-configs` key is reserved and requires typing its name to overwrite
- Temp files are created with 0600 permissions and cleaned up after each write

Add `backups/` to `.gitignore` — backup files contain configuration values, including secret placeholder names.

### Secret Management

The proxy supports secret interpolation using the `${SECRET_NAME}` pattern in authentication and header values.

#### Setting Secrets

Use wrangler to set secrets:

```bash
# Set a secret value
wrangler secret put API_TOKEN

# Set multiple secrets
wrangler secret put DB_PASSWORD
wrangler secret put SERVICE_KEY
```

#### Using Secrets in Configuration

```json
{
  "api": {
    "url": "https://api.example.com",
    "authConfigs": [
      {
        "header": "Authorization",
        "value": "Bearer ${API_TOKEN}"
      }
    ],
    "headers": {
      "X-Service-Key": "${SERVICE_KEY}"
    }
  }
}
```

**Security Notes:**

- Secrets are never logged or exposed in responses
- Missing secrets in authentication values will cause requests to fail
- Missing secrets in header values will fall back to the placeholder text
- Use descriptive secret names for easier management

#### Common Secret Patterns

```bash
# Bearer token authentication
Authorization: Bearer ${API_TOKEN}

# API key authentication
X-API-Key: ${SERVICE_API_KEY}

# Custom authentication
X-Custom-Auth: ${CUSTOM_AUTH_VALUE}
```

### Configuration Schema

Each server configuration supports:

- `url` (required): Base URL of the downstream server (must be HTTPS)
- `headers` (optional): Downstream headers; **override** client-supplied values with the same name (supports secret interpolation)
- `authConfigs` (optional): Array of authentication configurations; access is granted if any one matches

Legacy `auth` / `authHeader` fields are no longer supported: the runtime and
the configuration scripts reject them with an error instead of ignoring them.

### Example Configuration

Here's an example configuration showing various features:

```json
{
  "api": {
    "url": "https://api.example.com",
    "headers": {
      "X-Custom": "value",
      "X-Service-ID": "${SERVICE_ID}"
    },
    "authConfigs": [
      {
        "header": "Authorization",
        "value": "Bearer ${API_TOKEN}"
      }
    ]
  },
  "web": {
    "url": "https://web.example.com"
  },
  "images": {
    "url": "https://cdn.example.com",
    "headers": {
      "X-CDN": "true",
      "X-CDN-Key": "${CDN_API_KEY}"
    }
  },
  "custom-auth": {
    "url": "https://secure-api.example.com",
    "authConfigs": [
      {
        "header": "X-API-Key",
        "value": "${SECRET_API_KEY}"
      }
    ]
  },
  "multi-auth": {
    "url": "https://flexible-api.example.com",
    "authConfigs": [
      {
        "header": "Authorization",
        "value": "Bearer ${BEARER_TOKEN}"
      },
      {
        "header": "X-API-Key",
        "value": "${API_KEY}"
      },
      {
        "header": "X-Service-Token",
        "value": "${SERVICE_TOKEN}"
      }
    ]
  }
}
```

#### Multiple Authentication Headers

The new `authConfigs` array supports multiple authentication methods with the following schema:

```typescript
interface AuthConfig {
  header: string // Header name (e.g., "Authorization", "X-API-Key")
  value: string // Expected header value (supports ${SECRET_NAME} placeholders)
}
```

**Authentication Logic:**

- **Any One Match**: Access is granted if any configured auth header matches
- **All Headers Optional**: All auth headers are optional by default
- **No Auth Headers Present**: If no auth headers are configured, access is granted without authentication

### Request Routing

- Request to `/api/users/123` → routes to `api` server → `https://api.example.com/users/123`
- Request to `/web/dashboard` → routes to `web` server → `https://web.example.com/dashboard`
- Request to `/images/photo.jpg` → routes to `images` server → `https://cdn.example.com/photo.jpg`

### Header Forwarding

The proxy forwards headers as follows:

- **All incoming headers** are passed to the downstream server **except**:
  - Authentication headers configured in `authConfigs` (per-server and global)
  - `Host` and hop-by-hop headers (`Connection`, `Keep-Alive`, `TE`, `Trailer`,
    `Transfer-Encoding`, `Upgrade`, `Proxy-Authenticate`, `Proxy-Authorization`)
- **Configured downstream headers override** client-supplied headers with the
  same name. Clients cannot override values the operator configured for the
  downstream service.

The backend request is created with `redirect: 'manual'`, so a downstream 3xx
response is passed through instead of being followed (following it would replay
configured credentials to the redirect target).

**Example:**

```json
{
  "api": {
    "url": "https://api.example.com",
    "headers": { "X-Default": "${DEFAULT_VALUE}" },
    "authConfigs": [{ "header": "Authorization", "value": "Bearer ${API_TOKEN}" }]
  }
}
```

- Request with `X-Default: client-value` → downstream receives `X-Default: <configured value>` (config overrides)
- Request without `X-Default` → downstream receives `X-Default: <configured value>`
- `Authorization` is removed before forwarding (configured in `authConfigs`)

**Multiple Auth Headers Example:**

```json
{
  "multi-auth": {
    "url": "https://api.example.com",
    "authConfigs": [
      { "header": "Authorization", "value": "Bearer ${API_TOKEN}" },
      { "header": "X-API-Key", "value": "${SERVICE_KEY}" }
    ]
  }
}
```

- Request with both auth headers → downstream receives neither `Authorization` nor `X-API-Key`
- Both authentication headers are removed for security before forwarding to the downstream server
- Secret interpolation happens before header comparison and removal

### Authentication

If a server has an `authConfigs` array, incoming requests must include at least
one header matching a configured value (any-one-match). If the required header
is missing or doesn't match, the proxy returns a 401 Unauthorized response.

Example:

```json
{
  "api": {
    "url": "https://api.example.com",
    "authConfigs": [{ "header": "X-API-Key", "value": "secret-api-key-123" }]
  }
}
```

Then the incoming request must include:

```
X-API-Key: secret-api-key-123
```

#### Multiple Authentication Examples

**Example 1: Any One Valid Header**

```json
{
  "flexible-api": {
    "url": "https://api.example.com",
    "authConfigs": [
      { "header": "Authorization", "value": "Bearer ${TOKEN_123}" },
      { "header": "X-API-Key", "value": "${KEY_456}" }
    ]
  }
}
```

- Request with `Authorization: Bearer token123` → ✅ Success
- Request with `X-API-Key: key456` → ✅ Success
- Request with `Authorization: wrong` → ❌ 401 Unauthorized
- Request with no auth headers → ✅ Success (all optional)

**Example 2: Service-Specific Authentication**

```json
{
  "service-api": {
    "url": "https://api.example.com",
    "authConfigs": [
      { "header": "X-Service-Token", "value": "${SERVICE_TOKEN}" },
      { "header": "Authorization", "value": "Bearer ${BACKUP_TOKEN}" }
    ]
  }
}
```

- Request with `X-Service-Token: service789` → ✅ Success
- Request with `Authorization: Bearer token123` → ✅ Success
- Request with both headers → ✅ Success (any one match is sufficient)
- Request with no headers → ❌ 401 Unauthorized (auth configured but none provided)

**Example 3: Multiple API Key Support**

```json
{
  "multi-key-api": {
    "url": "https://api.example.com",
    "authConfigs": [
      { "header": "X-API-Key-V1", "value": "${LEGACY_API_KEY}" },
      { "header": "X-API-Key", "value": "${NEW_API_KEY}" },
      { "header": "Authorization", "value": "Bearer ${FALLBACK_TOKEN}" }
    ]
  }
}
```

- Supports multiple authentication methods for backward compatibility
- Clients can use any of the configured authentication methods
- Useful during API migrations or when supporting multiple client types

#### Global Authentication

Global authentication provides a master authentication layer that applies across all servers in the proxy. When configured, it creates a two-tier authentication flow that can override per-server authentication rules.

**Configuration Methods:**

1. **Environment Variable** (recommended for production):

```bash
wrangler secret put GLOBAL_AUTH_CONFIGS
# Enter JSON array when prompted:
# [{"header": "Authorization", "value": "Bearer ${GLOBAL_ADMIN_TOKEN}"}]
```

2. **KV Storage** (fallback method):

```bash
# Using the configuration script
bun run scripts/update-proxy-config.ts
# Choose "Set global authentication configuration"
```

**Global Auth Examples:**

**Example 1: Single Global Admin Token**

```json
[
  {
    "header": "Authorization",
    "value": "Bearer ${GLOBAL_ADMIN_TOKEN}"
  }
]
```

**Example 2: Multiple Global Auth Methods**

```json
[
  {
    "header": "Authorization",
    "value": "Bearer ${MASTER_TOKEN}"
  },
  {
    "header": "X-Admin-Key",
    "value": "${ADMIN_API_KEY}"
  },
  {
    "header": "X-Service-Token",
    "value": "${SERVICE_TOKEN}"
  }
]
```

**Two-Tier Authentication Flow:**

1. **Global Auth First**: System checks global authentication if a source exists (`GLOBAL_AUTH_CONFIGS` env var or the `global-auth-configs` KV key)
2. **Override Behavior**: Valid global auth grants access immediately (per-server auth skipped)
3. **Fallback Logic**: If global auth fails, per-server authentication may still grant access
4. **Mandatory Auth**: When global auth is configured — even with an empty array — authentication is always required; servers without their own auth are denied
5. **Fail Closed**: If a configured global auth source fails to load, parse, or validate, the worker returns 500 and never degrades to open access

**Use Cases:**

- **Administrative Access**: Provide master access across all proxy servers
- **Service Accounts**: Allow internal services to access any downstream service
- **Emergency Access**: Bypass per-server configuration during maintenance
- **Migration Support**: Maintain access while migrating per-server authentication

**Security Considerations:**

- Global auth headers are removed before forwarding to downstream services
- Same secret interpolation support (`${SECRET_NAME}`) as per-server auth
- Provides identical security guarantees as per-server authentication
- Use with caution - global auth bypasses all per-server restrictions

## Development

Bun is the only supported package manager.

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Run everything: typecheck, lint, format check, tests
bun run check

# Individually
bun run typecheck   # src, scripts, and tests
bun run lint        # src, scripts, and tests
bun run format:check
bun run test
bun run test:coverage
```

## Deployment

```bash
# Validate the worker bundles without deploying (dry run)
bun run build

# Deploy to production
bun run deploy
```

Continuous integration runs `bun install --frozen-lockfile` and `bun run check`
on every push and pull request to main (see `.github/workflows/ci.yml`).

## Error Handling

- `404 Not Found`: No server configuration found for the requested path
- `401 Unauthorized`: Authentication required but missing or invalid
- `500 Internal Server Error`: Configuration errors or invalid backend URLs
- `502 Bad Gateway`: Backend server is unreachable
