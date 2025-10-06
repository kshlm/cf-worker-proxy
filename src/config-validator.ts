import { ServerConfig, ErrorDetails, AuthConfig } from './types';
import { isValidHeaderValue } from './utils/auth-helpers';
import { PROTOCOLS } from './constants';

/**
 * Configuration validation result
 */
export interface ValidationResult {
  isValid: boolean;
  error?: ErrorDetails;
}

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
  if (!authConfig.header || authConfig.header.trim() === '') {
    return {
      isValid: false,
      error: {
        message: 'Configuration invalid: Auth header name cannot be empty.',
        status: 500,
        context: 'AuthConfig.header is required but empty'
      }
    };
  }

  // Check for valid header name format (basic validation)
  if (!/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(authConfig.header)) {
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

  // Validate each auth config
  for (const [index, authConfig] of authConfigs.entries()) {
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
 * Validates authentication configuration (legacy and new)
 */
export function validateAuthentication(auth?: string, authHeader?: string, authConfigs?: AuthConfig[]): ValidationResult {
  // Validate new authConfigs first
  const authConfigsValidation = validateAuthConfigs(authConfigs);
  if (!authConfigsValidation.isValid) {
    return authConfigsValidation;
  }

  // If authConfigs exist, we don't need to validate legacy auth
  if (authConfigs && authConfigs.length > 0) {
    return { isValid: true };
  }

  // Validate legacy auth
  if (!auth) {
    return { isValid: true }; // No authentication required
  }

  // Check if auth value is not empty
  if (auth.trim() === '') {
    return {
      isValid: false,
      error: {
        message: 'Configuration invalid: Authentication value cannot be empty.',
        status: 500,
        context: 'Auth field is present but empty'
      }
    };
  }

  // Validate custom auth header name if provided
  if (authHeader) {
    if (authHeader.trim() === '') {
      return {
        isValid: false,
        error: {
          message: 'Configuration invalid: Custom auth header name cannot be empty.',
          status: 500,
          context: 'authHeader is present but empty'
        }
      };
    }

    // Check for valid header name format (basic validation)
    if (!/^[a-zA-Z0-9-]+$/.test(authHeader)) {
      return {
        isValid: false,
        error: {
          message: 'Configuration invalid: Custom auth header name contains invalid characters.',
          status: 500,
          context: `authHeader "${authHeader}" contains invalid characters`
        }
      };
    }
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

  // Validate each header
  for (const [headerName, headerValue] of Object.entries(headers)) {
    // Validate header name
    if (typeof headerName !== 'string' || headerName.trim() === '') {
      return {
        isValid: false,
        error: {
          message: 'Configuration invalid: Header names must be non-empty strings.',
          status: 500,
          context: `Invalid header name: "${headerName}"`
        }
      };
    }

    // Validate header value
    if (typeof headerValue !== 'string') {
      return {
        isValid: false,
        error: {
          message: 'Configuration invalid: Header values must be strings.',
          status: 500,
          context: `Header "${headerName}" has invalid value type: ${typeof headerValue}`
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
  // Validate URL
  const urlValidation = validateBackendUrl(config.url);
  if (!urlValidation.isValid) {
    return urlValidation;
  }

  // Validate authentication (both legacy and new)
  const authValidation = validateAuthentication(config.auth, config.authHeader, config.authConfigs);
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