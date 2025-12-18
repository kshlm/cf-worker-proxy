import { AuthConfig, ServerConfig } from '../types';

/**
 * Returns auth configurations from server config
 */
export function mergeAuthConfigs(serverConfig: ServerConfig): AuthConfig[] {
  return serverConfig.authConfigs ? [...serverConfig.authConfigs] : []
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