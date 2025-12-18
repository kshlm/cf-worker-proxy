import { ServerConfig, AuthConfig } from './types';
import { mergeAuthConfigs, createHeaderExclusionSet, createHeadersExcluding } from './utils/auth-helpers';

/**
 * Finds a header value case-insensitively from request headers
 */
export function findHeaderValue(headers: Headers, headerName: string): string | null {
  return headers.get(headerName) || headers.get(headerName.toLowerCase()) || null;
}

/**
 * Creates a new Headers object by copying all headers from the original request
 * except the specified authentication header(s)
 */
export function createHeadersWithoutAuth(
  originalHeaders: Headers,
  authConfigs: AuthConfig[]
): Headers {
  const excludeHeaders = createHeaderExclusionSet(authConfigs);
  return createHeadersExcluding(originalHeaders, excludeHeaders);
}

/**
 * Adds custom headers to the modified headers, but only if they don't already exist
 * in the processed headers (after auth header removal)
 */
export function addCustomHeaders(
  modifiedHeaders: Headers,
  customHeaders: Record<string, string>
): void {
  if (!customHeaders) {
    return;
  }

  for (const [headerName, headerValue] of Object.entries(customHeaders)) {
    // Only add the header if it doesn't already exist in the processed headers
    // This allows custom Authorization headers to be added even if they were
    // removed from the original request for security
    if (!modifiedHeaders.has(headerName)) {
      modifiedHeaders.set(headerName, headerValue);
    }
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

  // Create headers without authentication headers
  const processedHeaders = allAuthConfigs.length > 0
    ? createHeadersWithoutAuth(originalRequest.headers, allAuthConfigs)
    : createHeadersWithoutAuth(originalRequest.headers, []);

  // Add custom headers from configuration
  addCustomHeaders(
    processedHeaders,
    serverConfig.headers || {}
  );

  return processedHeaders;
}

/**
 * Validates header name format (basic validation)
 */
export function isValidHeaderName(headerName: string): boolean {
  if (typeof headerName !== 'string' || headerName.trim() === '') {
    return false;
  }

  // Basic HTTP header name validation
  // RFC 7230 allows: token, which is any visible ASCII character except special characters
  return /^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(headerName);
}

// Re-export isValidHeaderValue from utils for backward compatibility
export { isValidHeaderValue } from './utils/auth-helpers';

/**
 * Gets all header names from a headers object in a case-insensitive manner
 */
export function getHeaderNamesLowercase(headers: Headers): string[] {
  const headerNames: string[] = [];

  for (const [key] of headers.entries()) {
    headerNames.push(key.toLowerCase());
  }

  return headerNames;
}