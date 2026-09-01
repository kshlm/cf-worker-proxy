import { ServerConfig, AuthConfig } from './types';
import {
  mergeAuthConfigs,
  createHeaderExclusionSet,
  createHeadersExcluding,
  FORBIDDEN_FORWARD_HEADERS
} from './utils/auth-helpers';

/**
 * Adds configured headers to the modified headers. Configured headers
 * override client-supplied values so downstream services receive the
 * credentials/attributes the operator intended.
 */
export function addCustomHeaders(
  modifiedHeaders: Headers,
  customHeaders: Record<string, string>
): void {
  if (!customHeaders) {
    return;
  }

  for (const [headerName, headerValue] of Object.entries(customHeaders)) {
    modifiedHeaders.set(headerName, headerValue);
  }
}

/**
 * Creates a new Headers object by copying all headers from the original request
 * except both global and per-server authentication headers
 */
export function processHeadersForProxy(
  originalRequest: Request,
  serverConfig: ServerConfig,
  globalAuthConfigs: AuthConfig[] = []
): Headers {
  // Merge per-server auth configurations
  const perServerAuthConfigs = mergeAuthConfigs(serverConfig);

  // Combine global and per-server auth configs for header removal
  const allAuthConfigs = [...globalAuthConfigs, ...perServerAuthConfigs];

  // Create headers without authentication headers, Host, and hop-by-hop headers
  const exclusionSet = createHeaderExclusionSet(allAuthConfigs);
  for (const forbidden of FORBIDDEN_FORWARD_HEADERS) {
    exclusionSet.add(forbidden);
  }
  const processedHeaders = createHeadersExcluding(originalRequest.headers, exclusionSet);

  // Add custom headers from configuration
  addCustomHeaders(
    processedHeaders,
    serverConfig.headers || {}
  );

  return processedHeaders;
}

/**
 * Re-export header validation from utils for backward compatibility
 */
export { isValidHeaderName, isValidHeaderValue } from './utils/auth-helpers';