import { Env, ServerConfig, RequestContext, KVOperationResult, AuthConfig } from './types';
import { processServerConfig } from './secret-interpolation';
import { validateProcessedConfig } from './config-validator';
import { processHeadersForProxy } from './header-processor';
import { mergeAuthConfigs } from './utils/auth-helpers';
import { loadGlobalAuthConfiguration, checkGlobalAuth } from './utils/global-auth';
import {
  createInvalidRouteResponse,
  createServerNotFoundResponse,
  createServiceUnavailableResponse,
  createConfigInvalidResponse,
  createUnauthorizedResponse,
  createBackendUnavailableResponse,
  createInternalServerErrorResponse
} from './constants';


/**
 * Extracts the first path segment from a URL pathname to use as server key.
 */
function getServerKey(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  return segments.length > 0 ? segments[0] : null
}

/**
 * Builds the backend URL by combining base URL with remaining path and query parameters.
 */
function buildBackendUrl(baseUrl: string, originalUrl: string, serverKey: string): string {
  const url = new URL(originalUrl)
  const pathname = url.pathname

  const serverKeyWithSlash = `/${serverKey}`
  const remainingPath = pathname.startsWith(serverKeyWithSlash)
    ? pathname.slice(serverKeyWithSlash.length)
    : pathname

  const cleanBaseUrl = baseUrl.replace(/\/$/, '')
  const cleanRemainingPath = remainingPath.startsWith('/') ? remainingPath : `/${remainingPath}`

  return `${cleanBaseUrl}${cleanRemainingPath}${url.search}`
}

/**
 * Checks if the incoming request has valid authentication using "any one match" logic.
 */
export function checkAuth(request: Request, authConfigs: AuthConfig[]): boolean {
  // Allow access if no headers have been configured
  if (authConfigs.length === 0) {
    return true
  }

  // Check if any auth header matches (any one match is sufficient)
  const hasValidMatch = authConfigs.some(config => {
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
  const url = new URL(request.url);
  const pathname = url.pathname;
  const serverKey = getServerKey(pathname);

  if (!serverKey) {
    return null;
  }

  return {
    request,
    serverKey,
    pathname,
    originalUrl: request.url
  };
}

/**
 * Loads server configuration from KV storage
 */
async function loadServerConfig(
  serverKey: string,
  env: Env
): Promise<KVOperationResult<ServerConfig>> {
  try {
    const serverData = await env.PROXY_SERVERS.get(serverKey, { type: 'json' });
    const config = serverData as ServerConfig;

    if (!config) {
      return {
        success: false,
        error: `No configuration found for server key: ${serverKey}`
      };
    }

    return {
      success: true,
      data: config
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `KV retrieval failed: ${errorMessage}`
    };
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
  globalAuthConfigs: AuthConfig[],
  perServerAuthConfigs: AuthConfig[]
): { authenticated: boolean; usedGlobalAuth: boolean } {
  const globalAuthConfigured = globalAuthConfigs.length > 0;

  // Check global authentication only if configured
  if (globalAuthConfigured) {
    const globalAuthResult = checkGlobalAuth(request, globalAuthConfigs);
    if (globalAuthResult) {
      return { authenticated: true, usedGlobalAuth: true };
    }
    // Global auth is configured but failed - continue to per-server auth
  }

  // Check per-server auth
  // Important: If global auth is configured and failed, we should not allow access
  // just because per-server auth is empty. Only allow per-server auth if it's actually configured.
  if (!globalAuthConfigured && perServerAuthConfigs.length === 0) {
    // No global auth configured and no per-server auth configured - allow access
    return { authenticated: true, usedGlobalAuth: false };
  }

  if (perServerAuthConfigs.length > 0) {
    const perServerAuthResult = checkAuth(request, perServerAuthConfigs);
    if (perServerAuthResult) {
      return { authenticated: true, usedGlobalAuth: false };
    }
  }

  // Neither global nor per-server auth succeeded and auth is required
  return { authenticated: false, usedGlobalAuth: false };
}

/**
 * Processes the complete request pipeline
 */
export async function processRequest(request: Request, env: Env): Promise<Response> {
  try {
    // Extract request context
    const requestContext = extractRequestContext(request);
    if (!requestContext) {
      return createInvalidRouteResponse();
    }

    // Load global auth configuration
    let globalAuthConfigs: AuthConfig[] = [];
    try {
      const globalAuthResult = await loadGlobalAuthConfiguration(env);
      if (globalAuthResult.error) {
        console.error(`Global auth configuration failed: ${globalAuthResult.error}`);
        return createConfigInvalidResponse(globalAuthResult.error);
      }
      globalAuthConfigs = globalAuthResult.configs;
    } catch (error) {
      console.error(`Global auth loading failed: ${error}`);
      const errorMessage = error instanceof Error ? error.message : 'Global auth configuration error';
      return createConfigInvalidResponse(`Global auth configuration failed: ${errorMessage}`);
    }

    // Load server configuration
    const configResult = await loadServerConfig(requestContext.serverKey, env);
    if (!configResult.success) {
      console.error(`Config load failed for server "${requestContext.serverKey}": ${configResult.error}`);

      if (configResult.error?.includes('No configuration found')) {
        return createServerNotFoundResponse();
      }
      return createServiceUnavailableResponse();
    }

    // Process configuration with secret interpolation
    let processedConfig: ServerConfig;
    try {
      processedConfig = processServerConfig(configResult.data!, env);
    } catch (error) {
      console.error(`Config processing failed for server "${requestContext.serverKey}": ${error}`);
      return createConfigInvalidResponse();
    }

    // Validate configuration
    try {
      const validation = validateProcessedConfig(processedConfig);
      if (!validation.isValid) {
        throw new Error(validation.error?.message || 'Configuration validation failed');
      }
    } catch (error) {
      console.error(`Config validation failed for server "${requestContext.serverKey}": ${error}`);
      const errorMessage = error instanceof Error ? error.message : 'Configuration invalid: Server setup requires review.';
      return createConfigInvalidResponse(errorMessage);
    }

    // Check authentication using two-tier flow
    const mergedAuthConfigs = mergeAuthConfigs(processedConfig);
    const authResult = checkTwoTierAuth(request, globalAuthConfigs, mergedAuthConfigs);

    if (!authResult.authenticated) {
      const authHeaders = [...globalAuthConfigs, ...mergedAuthConfigs].map(config => config.header).join(', ');
      console.warn(`Authentication failed for server "${requestContext.serverKey}" using headers: ${authHeaders}`);
      return createUnauthorizedResponse();
    }

    // Build backend URL
    const targetUrl = buildBackendUrl(
      processedConfig.url,
      requestContext.originalUrl,
      requestContext.serverKey
    );

    // Process headers (remove both global and per-server auth headers)
    const processedHeaders = processHeadersForProxy(
      request,
      processedConfig,
      globalAuthConfigs
    );

    // Create backend request
    const backendRequest = new Request(targetUrl, {
      method: request.method,
      headers: processedHeaders,
      body: request.body,
      redirect: request.redirect,
      duplex: 'half'
    } as RequestInit);

    // Forward to backend
    try {
      return await fetch(backendRequest);
    } catch (error) {
      const backendUrl = new URL(backendRequest.url).origin;
      console.error(`Backend request failed for server "${requestContext.serverKey}" (target: "${backendUrl}"): ${error}`);
      return createBackendUnavailableResponse();
    }

  } catch (error) {
    console.error(`Unexpected error processing request to "${request.url}":`, error);
    return createInternalServerErrorResponse();
  }
}
