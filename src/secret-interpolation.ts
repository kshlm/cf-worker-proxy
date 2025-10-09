import { Env, ServerConfig, AuthConfig } from './types';

const SECRET_PATTERN = /\$\{([\w-]+)\}/g;

/**
 * Interpolates secrets into a string using ${SECRET_NAME} pattern.
 */
export function interpolateSecret(
  value: string,
  env: Env,
  isAuth: boolean = false
): string {
  return value.replace(SECRET_PATTERN, (match, secretName) => {
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
}

/**
 * Validates that a string contains secret placeholders
 */
export function hasSecretPlaceholders(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

/**
 * Extracts all secret names from a string
 */
export function extractSecretNames(value: string): string[] {
  const secretNames: string[] = [];
  let match;

  // Reset regex state
  SECRET_PATTERN.lastIndex = 0;

  while ((match = SECRET_PATTERN.exec(value)) !== null) {
    secretNames.push(match[1]);
  }

  // Reset regex state again
  SECRET_PATTERN.lastIndex = 0;

  return secretNames;
}

/**
 * Checks if all required secrets are available in the environment
 */
export function validateSecretsAvailable(secretNames: string[], env: Env): boolean {
  return secretNames.every(secretName => env[secretName] !== undefined);
}

/**
 * Processes a server configuration by interpolating secrets in auth and headers.
 */
export function processServerConfig(config: ServerConfig, env: Env): ServerConfig {
  const processedConfig = { ...config };

  // Process authentication field
  if (processedConfig.auth) {
    try {
      const interpolatedAuth = interpolateSecret(processedConfig.auth, env, true);
      if (interpolatedAuth === null) {
        throw new Error('Auth interpolation failed');
      }
      processedConfig.auth = interpolatedAuth;
    } catch {
      throw new Error('Missing required authentication secret');
    }
  }

  // Process authConfigs
  if (processedConfig.authConfigs) {
    processedConfig.authConfigs = processedConfig.authConfigs.map((config): AuthConfig => ({
      header: config.header,
      value: interpolateSecret(config.value, env, true)
    }));
  }

  // Process headers
  if (processedConfig.headers) {
    processedConfig.headers = Object.fromEntries(
      Object.entries(processedConfig.headers).map(([key, value]) => [
        key,
        interpolateSecret(value, env, false) ?? value
      ])
    );
  }

  return processedConfig;
}

/**
 * Processes global auth configuration by interpolating secrets in auth configs.
 */
export function processGlobalAuthConfigs(configs: AuthConfig[], env: Env): AuthConfig[] {
  return configs.map((config): AuthConfig => ({
    header: config.header,
    value: interpolateSecret(config.value, env, true)
  }));
}
