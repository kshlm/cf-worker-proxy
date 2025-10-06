import { AuthConfig, ServerConfig } from '../types';
import { DEFAULT_HEADERS } from '../constants';

/**
 * Merges legacy auth configuration with new authConfigs array.
 * Legacy auth is only added if no config with the same header name exists in authConfigs.
 */
export function mergeAuthConfigs(serverConfig: ServerConfig): AuthConfig[] {
  const authConfigs: AuthConfig[] = serverConfig.authConfigs ? [...serverConfig.authConfigs] : []

  // If legacy auth exists, merge it only if no conflict with existing header
  if (serverConfig.auth) {
    const legacyHeaderName = serverConfig.authHeader || DEFAULT_HEADERS.AUTHORIZATION
    const headerExists = authConfigs.some(config =>
      config.header.toLowerCase() === legacyHeaderName.toLowerCase()
    )

    if (!headerExists) {
      authConfigs.push({
        header: legacyHeaderName,
        value: serverConfig.auth
      })
    }
  }

  return authConfigs
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
 * Creates a Set of lowercase header names to exclude from forwarding
 */
export function createHeaderExclusionSet(authConfigs: AuthConfig[]): Set<string> {
  return new Set(authConfigs.map(config => config.header.toLowerCase()));
}

/**
 * Creates a new Headers object by excluding specified header names (case-insensitive)
 */
export function createHeadersExcluding(
  originalHeaders: Headers,
  excludeHeaders: Set<string>
): Headers {
  const modifiedHeaders = new Headers();

  originalHeaders.forEach((value, key) => {
    if (!excludeHeaders.has(key.toLowerCase())) {
      modifiedHeaders.set(key, value);
    }
  });

  return modifiedHeaders;
}