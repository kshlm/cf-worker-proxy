import { Env, ServerConfig, RequestContext, KVOperationResult, AuthConfig } from './types'
import { processServerConfig } from './secret-interpolation'
import { validateProcessedConfig } from './config-validator'
import { processHeadersForProxy } from './header-processor'
import { mergeAuthConfigs } from './utils/auth-helpers'
import {
  loadGlobalAuthConfiguration,
  checkGlobalAuth,
  GLOBAL_AUTH_KV_KEY,
} from './utils/global-auth'
import { ERROR_MESSAGES } from './constants'
import {
  createInvalidRouteResponse,
  createServerNotFoundResponse,
  createConfigInvalidResponse,
  createUnauthorizedResponse,
  createBackendUnavailableResponse,
  createInternalServerErrorResponse,
} from './constants'

/**
 * Extracts the first path segment from a URL pathname to use as server key.
 */
function getServerKey(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  return segments.length > 0 ? segments[0] : null
}

/**
 * Builds the backend URL by combining base URL with remaining path and query
 * parameters. Uses the URL API so the composition cannot produce double
 * slashes, dropped root paths, or malformed joins.
 */
function buildBackendUrl(baseUrl: string, originalUrl: string, serverKey: string): string {
  const url = new URL(originalUrl)

  const serverKeyWithSlash = `/${serverKey}`
  const remainingPath = url.pathname.startsWith(serverKeyWithSlash)
    ? url.pathname.slice(serverKeyWithSlash.length)
    : url.pathname

  const base = new URL(baseUrl)
  const basePath = base.pathname.replace(/\/+$/, '')
  const suffix = remainingPath.replace(/^\/+/, '')

  base.pathname = suffix === '' ? `${basePath}/` : `${basePath}/${suffix}`
  base.search = url.search

  return base.toString()
}

/**
 * Checks the incoming request against auth configs using "any one match"
 * logic. An empty config list means no authentication requirement, so access
 * is allowed; callers must not pass empty configs when auth is required.
 */
export function checkAuth(request: Request, authConfigs: AuthConfig[]): boolean {
  if (authConfigs.length === 0) {
    return true
  }

  // Check if any auth header matches (any one match is sufficient)
  const hasValidMatch = authConfigs.some((config) => {
    const headerValue = request.headers.get(config.header)
    if (!headerValue) return false
    return headerValue === config.value
  })

  // If any header matches, allow access
  if (hasValidMatch) {
    return true
  }

  // Return false is no header matches
  return false
}

/**
 * Extracts request context from the incoming request
 */
function extractRequestContext(request: Request): RequestContext | null {
  const url = new URL(request.url)
  const pathname = url.pathname
  const serverKey = getServerKey(pathname)

  if (!serverKey) {
    return null
  }

  return {
    request,
    serverKey,
    pathname,
    originalUrl: request.url,
  }
}

/**
 * Loads server configuration from KV storage. Errors are discriminated so
 * the caller can distinguish client-fixable 404s from internal 500s without
 * string matching.
 */
async function loadServerConfig(
  serverKey: string,
  env: Env,
): Promise<KVOperationResult<ServerConfig>> {
  // The global auth KV key is reserved; it must never act as a route config.
  if (serverKey === GLOBAL_AUTH_KV_KEY) {
    return { success: false, error: { kind: 'reserved' } }
  }

  try {
    const serverData = await env.PROXY_SERVERS.get(serverKey, { type: 'json' })

    if (serverData === null || serverData === undefined) {
      return { success: false, error: { kind: 'missing' } }
    }

    // A malformed stored value may deserialize to a non-object (string,
    // number, array). Treat anything without the required url field as
    // malformed rather than crashing downstream.
    if (
      typeof serverData !== 'object' ||
      Array.isArray(serverData) ||
      typeof (serverData as { url?: unknown }).url !== 'string'
    ) {
      return {
        success: false,
        error: {
          kind: 'malformed',
          message: 'Stored config is not a valid server configuration object',
        },
      }
    }

    return { success: true, data: serverData as ServerConfig }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: { kind: 'kv-failure', message: errorMessage } }
  }
}

/**
 * Implements two-tier authentication flow:
 * 1. Check global authentication first (only if configured)
 * 2. If global auth succeeds, allow access (override per-server auth)
 * 3. If global auth fails, fall back to per-server auth
 * 4. If global auth is configured but neither succeeds, deny access
 */
export function checkTwoTierAuth(
  request: Request,
  globalAuthConfigured: boolean,
  globalAuthConfigs: AuthConfig[],
  perServerAuthConfigs: AuthConfig[],
): { authenticated: boolean; usedGlobalAuth: boolean } {
  // Global auth is configured when a source exists (env or KV), even with an
  // empty config array. Configured state is threaded in by the caller so an
  // empty array can never silently disable authentication.
  if (globalAuthConfigured) {
    if (checkGlobalAuth(request, globalAuthConfigs)) {
      return { authenticated: true, usedGlobalAuth: true }
    }
    // Global auth failed - per-server auth may still grant access, but an
    // empty per-server config no longer means open access below.
  } else if (perServerAuthConfigs.length === 0) {
    // No global auth and no per-server auth configured - allow access
    return { authenticated: true, usedGlobalAuth: false }
  }

  if (perServerAuthConfigs.length > 0 && checkAuth(request, perServerAuthConfigs)) {
    return { authenticated: true, usedGlobalAuth: false }
  }

  // Auth is required and neither tier succeeded
  return { authenticated: false, usedGlobalAuth: false }
}

/**
 * Processes the complete request pipeline
 */
export async function processRequest(request: Request, env: Env): Promise<Response> {
  try {
    // Extract request context
    const requestContext = extractRequestContext(request)
    if (!requestContext) {
      return createInvalidRouteResponse()
    }

    // Load global auth configuration. Fail closed on any error with a
    // present source; only a genuinely absent source disables global auth.
    let globalAuthConfigured = false
    let globalAuthConfigs: AuthConfig[] = []
    const globalAuthResult = await loadGlobalAuthConfiguration(env)
    if (globalAuthResult.state === 'error') {
      console.error(`Global auth configuration failed: ${globalAuthResult.error}`)
      return createConfigInvalidResponse(ERROR_MESSAGES.CONFIG_INVALID_REVIEW)
    }
    if (globalAuthResult.state === 'configured') {
      globalAuthConfigured = true
      globalAuthConfigs = globalAuthResult.configs
    }

    // Load server configuration
    const configResult = await loadServerConfig(requestContext.serverKey, env)
    if (!configResult.success) {
      console.error(
        `Config load failed for server "${requestContext.serverKey}" (${configResult.error.kind}):`,
        'message' in configResult.error ? configResult.error.message : '',
      )

      // Missing or reserved keys are client-fixable 404s; KV failures and
      // malformed stored values are internal 500s.
      if (configResult.error.kind === 'missing') {
        return createServerNotFoundResponse()
      }
      if (configResult.error.kind === 'reserved') {
        return createInvalidRouteResponse()
      }
      return createConfigInvalidResponse()
    }

    // Process configuration with secret interpolation
    let processedConfig: ServerConfig
    try {
      processedConfig = processServerConfig(configResult.data!, env)
    } catch (error) {
      console.error(`Config processing failed for server "${requestContext.serverKey}": ${error}`)
      return createConfigInvalidResponse()
    }

    // Validate configuration. Any failure returns a generic response;
    // validation details go to logs only, never to the client.
    const validation = validateProcessedConfig(processedConfig)
    if (!validation.isValid) {
      console.error(
        `Config validation failed for server "${requestContext.serverKey}":`,
        validation.error?.context || validation.error?.message,
      )
      return createConfigInvalidResponse()
    }

    // Check authentication using two-tier flow
    const mergedAuthConfigs = mergeAuthConfigs(processedConfig)
    const authResult = checkTwoTierAuth(
      request,
      globalAuthConfigured,
      globalAuthConfigs,
      mergedAuthConfigs,
    )

    if (!authResult.authenticated) {
      const authHeaders = [...globalAuthConfigs, ...mergedAuthConfigs]
        .map((config) => config.header)
        .join(', ')
      console.warn(
        `Authentication failed for server "${requestContext.serverKey}" using headers: ${authHeaders}`,
      )
      return createUnauthorizedResponse()
    }

    // Build backend URL
    const targetUrl = buildBackendUrl(
      processedConfig.url,
      requestContext.originalUrl,
      requestContext.serverKey,
    )

    // Process headers (remove both global and per-server auth headers)
    const processedHeaders = processHeadersForProxy(request, processedConfig, globalAuthConfigs)

    // Create backend request
    const backendRequest = new Request(targetUrl, {
      method: request.method,
      headers: processedHeaders,
      body: request.body,
      // Manual redirects prevent 3xx responses from causing the worker to
      // replay configured credentials to a different origin.
      redirect: 'manual',
      duplex: 'half',
    } as RequestInit)

    // Forward to backend
    try {
      return await fetch(backendRequest)
    } catch (error) {
      const backendUrl = new URL(backendRequest.url).origin
      console.error(
        `Backend request failed for server "${requestContext.serverKey}" (target: "${backendUrl}"): ${error}`,
      )
      return createBackendUnavailableResponse()
    }
  } catch (error) {
    console.error(`Unexpected error processing request to "${request.url}":`, error)
    return createInternalServerErrorResponse()
  }
}
