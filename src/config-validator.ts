import { ServerConfig, ErrorDetails, AuthConfig } from './types';
import { isValidHeaderValue, isValidHeaderName } from './utils/auth-helpers';
import { PROTOCOLS } from './constants';

/**
 * Configuration validation result
 */
export interface ValidationResult {
  isValid: boolean;
  error?: ErrorDetails;
}

/**
 * Legacy auth fields removed from the runtime. Their presence in a server
 * config is a rejection, never a silent ignore.
 */
const LEGACY_AUTH_FIELDS = ['auth', 'authHeader'] as const;

/**
 * Validates a backend URL to ensure it's properly formatted and secure
 */
export function validateBackendUrl(url: string): ValidationResult {
  try {
    const parsedUrl = new URL(url);

    // Check if protocol is HTTPS
    if (parsedUrl.protocol !== PROTOCOLS.HTTPS) {
      return {
        isValid: false,
        error: {
          message: 'Configuration invalid: Backend URL is malformed or insecure.',
          status: 500,
          context: `URL "${url}" uses protocol "${parsedUrl.protocol}" instead of "https:"`
        }
      };
    }

    // Check if hostname exists
    if (!parsedUrl.hostname) {
      return {
        isValid: false,
        error: {
          message: 'Configuration invalid: Backend URL is malformed or insecure.',
          status: 500,
          context: `URL "${url}" has no hostname`
        }
      };
    }

    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: {
        message: 'Configuration invalid: Backend URL is malformed or insecure.',
        status: 500,
        context: `Failed to parse URL "${url}": ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    };
  }
}

/**
 * Validates a single AuthConfig
 */
export function validateAuthConfig(authConfig: AuthConfig): ValidationResult {
  // Validate header name
  if (!isValidHeaderName(authConfig.header)) {
    return {
      isValid: false,
      error: {
        message: 'Configuration invalid: Auth header name contains invalid characters.',
        status: 500,
        context: `AuthConfig.header "${authConfig.header}" contains invalid characters`
      }
    };
  }

  // Validate header value
  if (!authConfig.value || authConfig.value.trim() === '') {
    return {
      isValid: false,
      error: {
        message: 'Configuration invalid: Auth header value cannot be empty.',
        status: 500,
        context: `AuthConfig.value for header "${authConfig.header}" is required but empty`
      }
    };
  }

  // Validate header value format
  if (!isValidHeaderValue(authConfig.value)) {
    return {
      isValid: false,
      error: {
        message: 'Configuration invalid: Auth header value contains invalid characters.',
        status: 500,
        context: `AuthConfig.value for header "${authConfig.header}" contains invalid characters`
      }
    };
  }

  return { isValid: true };
}

/**
 * Validates authConfigs array
 */
export function validateAuthConfigs(authConfigs?: AuthConfig[]): ValidationResult {
  if (!authConfigs) {
    return { isValid: true }; // No auth configs
  }

  // Check if authConfigs is an array
  if (!Array.isArray(authConfigs)) {
    return {
      isValid: false,
      error: {
        message: 'Configuration invalid: authConfigs must be an array.',
        status: 500,
        context: 'authConfigs is not an array'
      }
    };
  }

  // Validate each auth config, rejecting duplicate header names (case-insensitive)
  const seenHeaders = new Set<string>();
  for (const [index, authConfig] of authConfigs.entries()) {
    const headerKey = authConfig.header.toLowerCase();
    if (seenHeaders.has(headerKey)) {
      return {
        isValid: false,
        error: {
          message: 'Configuration invalid: Duplicate auth header names are not allowed.',
          status: 500,
          context: `authConfigs header "${authConfig.header}" appears more than once`
        }
      };
    }
    seenHeaders.add(headerKey);

    const validation = validateAuthConfig(authConfig);
    if (!validation.isValid) {
      return {
        isValid: false,
        error: {
          ...validation.error!,
          context: `${validation.error!.context} (at index ${index})`
        }
      };
    }
  }

  return { isValid: true };
}

/**
 * Validates authentication configuration
 */
export function validateAuthentication(authConfigs?: AuthConfig[]): ValidationResult {
  // Validate authConfigs
  const authConfigsValidation = validateAuthConfigs(authConfigs);
  if (!authConfigsValidation.isValid) {
    return authConfigsValidation;
  }

  return { isValid: true };
}


/**
 * Validates custom headers configuration
 */
export function validateHeaders(headers?: Record<string, string>): ValidationResult {
  if (!headers) {
    return { isValid: true }; // No custom headers
  }

  // Check if headers is an object
  if (typeof headers !== 'object' || headers === null) {
    return {
      isValid: false,
      error: {
        message: 'Configuration invalid: Headers must be an object.',
        status: 500,
        context: 'Headers configuration is not a valid object'
      }
    };
  }

  // Validate each header: names must be valid HTTP tokens, values must be
  // strings without control characters. Empty values are allowed.
  for (const [headerName, headerValue] of Object.entries(headers)) {
    if (!isValidHeaderName(headerName)) {
      return {
        isValid: false,
        error: {
          message: 'Configuration invalid: Header names must be valid HTTP header tokens.',
          status: 500,
          context: `Invalid header name: "${headerName}"`
        }
      };
    }

    if (typeof headerValue !== 'string' || !isValidHeaderValue(headerValue)) {
      return {
        isValid: false,
        error: {
          message: 'Configuration invalid: Header values must be strings without control characters.',
          status: 500,
          context: `Header "${headerName}" has an invalid value`
        }
      };
    }
  }

  return { isValid: true };
}

/**
 * Validates a complete server configuration
 */
export function validateProcessedConfig(config: ServerConfig): ValidationResult {
  // Reject removed legacy auth fields fail-closed
  const record = config as unknown as Record<string, unknown>;
  const legacyFields = LEGACY_AUTH_FIELDS.filter(field => record[field] !== undefined);
  if (legacyFields.length > 0) {
    return {
      isValid: false,
      error: {
        message: 'Configuration invalid: Legacy auth fields are no longer supported.',
        status: 500,
        context: `Server config contains unsupported legacy field(s): ${legacyFields.join(', ')}. Use authConfigs instead.`
      }
    };
  }

  // Validate URL
  const urlValidation = validateBackendUrl(config.url);
  if (!urlValidation.isValid) {
    return urlValidation;
  }

  // Validate authentication
  const authValidation = validateAuthentication(config.authConfigs);
  if (!authValidation.isValid) {
    return authValidation;
  }

  // Validate headers
  const headersValidation = validateHeaders(config.headers);
  if (!headersValidation.isValid) {
    return headersValidation;
  }

  return { isValid: true };
}