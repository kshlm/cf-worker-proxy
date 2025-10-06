import { ProcessedServerConfig } from './types';
import { DEFAULT_HEADERS } from './constants';

/**
 * Service for processing HTTP headers in proxy requests
 */
export class HeaderProcessor {
  /**
   * Finds a header value case-insensitively from request headers
   *
   * @param headers - The request headers to search
   * @param headerName - The header name to find (case-insensitive)
   * @returns The header value or null if not found
   */
  public findHeaderValue(headers: Headers, headerName: string): string | null {
    const searchName = headerName.toLowerCase();

    for (const [key, value] of headers.entries()) {
      if (key.toLowerCase() === searchName) {
        return value;
      }
    }

    return null;
  }

  /**
   * Creates a new Headers object by copying all headers from the original request
   * except the specified authentication header
   *
   * @param originalHeaders - The original request headers
   * @param authHeaderName - The authentication header name to exclude
   * @returns New Headers object without the auth header
   */
  public createHeadersWithoutAuth(
    originalHeaders: Headers,
    authHeaderName: string = DEFAULT_HEADERS.AUTHORIZATION
  ): Headers {
    const modifiedHeaders = new Headers();
    const excludeHeaderName = authHeaderName.toLowerCase();

    // Copy all headers except the authentication header
    for (const [key, value] of originalHeaders.entries()) {
      if (key.toLowerCase() !== excludeHeaderName) {
        modifiedHeaders.set(key, value);
      }
    }

    return modifiedHeaders;
  }

  /**
   * Adds custom headers to the modified headers, but only if they don't already exist
   * in the processed headers (after auth header removal)
   *
   * @param modifiedHeaders - The headers object to modify
   * @param customHeaders - Custom headers from configuration
   */
  public addCustomHeaders(
    modifiedHeaders: Headers,
    customHeaders: Record<string, string>
  ): void {
    if (!customHeaders) {
      return;
    }

    Object.entries(customHeaders).forEach(([headerName, headerValue]) => {
      // Only add the header if it doesn't already exist in the processed headers
      // This allows custom Authorization headers to be added even if they were
      // removed from the original request for security
      if (!modifiedHeaders.has(headerName)) {
        modifiedHeaders.set(headerName, headerValue);
      }
    });
  }

  /**
   * Processes headers for a proxy request by:
   * 1. Copying all incoming headers except the auth header
   * 2. Adding custom headers from configuration (only if not present in processed headers)
   *
   * @param originalRequest - The original incoming request
   * @param serverConfig - The processed server configuration
   * @returns Processed headers ready for the downstream request
   */
  public processHeadersForProxy(
    originalRequest: Request,
    serverConfig: ProcessedServerConfig
  ): Headers {
    const authHeaderName = serverConfig.authHeader || DEFAULT_HEADERS.AUTHORIZATION;

    // Create headers without the authentication header
    const processedHeaders = this.createHeadersWithoutAuth(
      originalRequest.headers,
      authHeaderName
    );

    // Add custom headers from configuration
    this.addCustomHeaders(
      processedHeaders,
      serverConfig.headers || {}
    );

    return processedHeaders;
  }

  /**
   * Validates header name format (basic validation)
   *
   * @param headerName - The header name to validate
   * @returns True if the header name appears valid
   */
  public isValidHeaderName(headerName: string): boolean {
    if (typeof headerName !== 'string' || headerName.trim() === '') {
      return false;
    }

    // Basic HTTP header name validation
    // RFC 7230 allows: token, which is any visible ASCII character except special characters
    return /^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(headerName);
  }

  /**
   * Validates header value format
   *
   * @param headerValue - The header value to validate
   * @returns True if the header value appears valid
   */
  public isValidHeaderValue(headerValue: string): boolean {
    if (typeof headerValue !== 'string') {
      return false;
    }

    // Basic validation - header values should not contain control characters
    // except for tab (0x09) and space (0x20)
    return !/[\x00-\x08\x0A-\x1F\x7F]/.test(headerValue);
  }

  /**
   * Gets all header names from a headers object in a case-insensitive manner
   *
   * @param headers - The headers object
   * @returns Array of header names in lower case for comparison
   */
  public getHeaderNamesLowercase(headers: Headers): string[] {
    const headerNames: string[] = [];

    for (const [key] of headers.entries()) {
      headerNames.push(key.toLowerCase());
    }

    return headerNames;
  }
}

// Export singleton instance for convenience
export const headerProcessor = new HeaderProcessor();