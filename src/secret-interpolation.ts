import { Env, ServerConfig, ProcessedServerConfig } from './types';

/**
 * Service for handling secret interpolation in configuration values
 */
export class SecretInterpolationService {
  private readonly secretPattern = /\$\{([\w-]+)\}/g;

  /**
   * Interpolates secrets into a string using ${SECRET_NAME} pattern.
   * Falls back to original placeholder if secret is missing.
   * Returns null if any required secret is missing (for auth fields).
   *
   * @param value - The string containing secret placeholders
   * @param env - Environment variables containing secrets
   * @param isAuth - Whether this is an authentication field (required secrets)
   * @returns The interpolated string or null if interpolation fails for auth fields
   */
  public interpolateSecret(
    value: string,
    env: Env,
    isAuth: boolean = false
  ): string | null {
    const result = value.replace(this.secretPattern, (match, secretName) => {
      const secretValue = env[secretName] as string | undefined;

      if (secretValue !== undefined) {
        return secretValue;
      }

      // For auth fields, missing secrets should cause failure
      if (isAuth) {
        throw new Error(`Missing required secret: ${secretName}`);
      }

      // For headers, fallback to placeholder
      return match;
    });

    return result;
  }

  /**
   * Validates that a string contains secret placeholders
   *
   * @param value - The string to check
   * @returns True if the string contains secret placeholders
   */
  public hasSecretPlaceholders(value: string): boolean {
    return this.secretPattern.test(value);
  }

  /**
   * Extracts all secret names from a string
   *
   * @param value - The string containing secret placeholders
   * @returns Array of secret names found in the string
   */
  public extractSecretNames(value: string): string[] {
    const secretNames: string[] = [];
    let match;

    // Reset regex state
    this.secretPattern.lastIndex = 0;

    while ((match = this.secretPattern.exec(value)) !== null) {
      secretNames.push(match[1]);
    }

    // Reset regex state again
    this.secretPattern.lastIndex = 0;

    return secretNames;
  }

  /**
   * Checks if all required secrets are available in the environment
   *
   * @param secretNames - Array of secret names to check
   * @param env - Environment variables
   * @returns True if all secrets are available
   */
  public validateSecretsAvailable(secretNames: string[], env: Env): boolean {
    return secretNames.every(secretName => env[secretName] !== undefined);
  }

  /**
   * Processes a server configuration by interpolating secrets in auth and headers.
   * Throws error if required auth secrets are missing.
   *
   * @param config - The server configuration to process
   * @param env - Environment variables containing secrets
   * @returns Processed configuration with interpolated secrets
   * @throws Error if required authentication secrets are missing
   */
  public processServerConfig(config: ServerConfig, env: Env): ProcessedServerConfig {
    const processedConfig = { ...config };

    // Process authentication field
    if (processedConfig.auth) {
      try {
        const interpolatedAuth = this.interpolateSecret(processedConfig.auth, env, true);
        if (interpolatedAuth === null) {
          throw new Error('Auth interpolation failed');
        }
        processedConfig.auth = interpolatedAuth;
      } catch (error) {
        throw new Error('Missing required authentication secret');
      }
    }

    // Process headers
    if (processedConfig.headers) {
      processedConfig.headers = Object.fromEntries(
        Object.entries(processedConfig.headers).map(([key, value]) => [
          key,
          this.interpolateSecret(value, env, false) ?? value
        ])
      );
    }

    return processedConfig;
  }
}

// Export singleton instance for convenience
export const secretInterpolationService = new SecretInterpolationService();