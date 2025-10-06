import { Env, ServerConfig, RequestContext, KVOperationResult, AuthConfig } from './types';
import { processServerConfig } from './secret-interpolation';
import { validateProcessedConfig } from './config-validator';
import { processHeadersForProxy } from './header-processor';
import { mergeAuthConfigs } from './utils/auth-helpers';
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
function checkAuth(request: Request, authConfigs: AuthConfig[]): boolean {
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
 * Processes the complete request pipeline
 */
export async function processRequest(request: Request, env: Env): Promise<Response> {
  try {
    // Extract request context
    const requestContext = extractRequestContext(request);
    if (!requestContext) {
      return createInvalidRouteResponse();
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

    // Check authentication
    const mergedAuthConfigs = mergeAuthConfigs(processedConfig);
    if (!checkAuth(request, mergedAuthConfigs)) {
      const authHeaders = mergedAuthConfigs.map(config => config.header).join(', ');
      console.warn(`Authentication failed for server "${requestContext.serverKey}" using headers: ${authHeaders}`);
      return createUnauthorizedResponse();
    }

    // Build backend URL
    const targetUrl = buildBackendUrl(
      processedConfig.url,
      requestContext.originalUrl,
      requestContext.serverKey
    );

    // Process headers
    const processedHeaders = processHeadersForProxy(
      request,
      processedConfig
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
