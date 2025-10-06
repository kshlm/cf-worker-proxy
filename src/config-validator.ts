import { ProcessedServerConfig, ErrorDetails } from './types';
import { PROTOCOLS } from './constants';

/**
 * Configuration validation result
 */
export interface ValidationResult {
  isValid: boolean;
  error?: ErrorDetails;
}

/**
 * Service for validating server configurations
 */
export class ConfigValidator {
  /**
   * Validates a backend URL to ensure it's properly formatted and secure
   *
   * @param url - The URL to validate
   * @returns ValidationResult indicating if the URL is valid
   */
  public validateBackendUrl(url: string): ValidationResult {
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
   * Validates authentication configuration
   *
   * @param auth - Authentication value to validate
   * @param authHeader - Custom auth header name (optional)
   * @returns ValidationResult indicating if authentication config is valid
   */
  public validateAuthentication(auth?: string, authHeader?: string): ValidationResult {
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
   *
   * @param headers - Headers object to validate
   * @returns ValidationResult indicating if headers are valid
   */
  public validateHeaders(headers?: Record<string, string>): ValidationResult {
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
   * Validates a complete processed server configuration
   *
   * @param config - The processed server configuration to validate
   * @returns ValidationResult indicating if the configuration is valid
   */
  public validateProcessedConfig(config: ProcessedServerConfig): ValidationResult {
    // Validate URL
    const urlValidation = this.validateBackendUrl(config.url);
    if (!urlValidation.isValid) {
      return urlValidation;
    }

    // Validate authentication
    const authValidation = this.validateAuthentication(config.auth, config.authHeader);
    if (!authValidation.isValid) {
      return authValidation;
    }

    // Validate headers
    const headersValidation = this.validateHeaders(config.headers);
    if (!headersValidation.isValid) {
      return headersValidation;
    }

    return { isValid: true };
  }
}

// Export singleton instance for convenience
export const configValidator = new ConfigValidator();