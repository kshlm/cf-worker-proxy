import { ServerConfig } from './types';
import { DEFAULT_HEADERS } from './constants';

/**
 * Finds a header value case-insensitively from request headers
 */
export function findHeaderValue(headers: Headers, headerName: string): string | null {
  return headers.get(headerName) || headers.get(headerName.toLowerCase()) || null;
}

/**
 * Creates a new Headers object by copying all headers from the original request
 * except the specified authentication header
 */
export function createHeadersWithoutAuth(
  originalHeaders: Headers,
  authHeaderName: string = DEFAULT_HEADERS.AUTHORIZATION
): Headers {
  const modifiedHeaders = new Headers();
  const excludeHeaderName = authHeaderName.toLowerCase();

  originalHeaders.forEach((value, key) => {
    if (key.toLowerCase() !== excludeHeaderName) {
      modifiedHeaders.set(key, value);
    }
  });

  return modifiedHeaders;
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
 * Processes headers for a proxy request by:
 * 1. Copying all incoming headers except the auth header
 * 2. Adding custom headers from configuration (only if not present in processed headers)
 */
export function processHeadersForProxy(
  originalRequest: Request,
  serverConfig: ServerConfig
): Headers {
  const authHeaderName = serverConfig.authHeader || DEFAULT_HEADERS.AUTHORIZATION;

  // Create headers without the authentication header
  const processedHeaders = createHeadersWithoutAuth(
    originalRequest.headers,
    authHeaderName
  );

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

/**
 * Validates header value format
 */
export function isValidHeaderValue(headerValue: string): boolean {
  if (typeof headerValue !== 'string') {
    return false;
  }

  // Basic validation - header values should not contain control characters
  // except for tab (0x09) and space (0x20)
  return !/[\x00-\x08\x0A-\x1F\x7F]/u.test(headerValue);
}

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