import { Env, ServerConfig, AuthConfig } from './types'

const SECRET_PATTERN = /\$\{([\w-]+)\}/g

/**
 * Interpolates secrets into a string using ${SECRET_NAME} pattern.
 * Only string env values are interpolated; non-string values (e.g. KV
 * namespace objects leaking into env) are treated as missing secrets.
 */
export function interpolateSecret(value: string, env: Env, isAuth: boolean = false): string {
  return value.replace(SECRET_PATTERN, (match, secretName) => {
    const secretValue = env[secretName]

    if (typeof secretValue === 'string') {
      return secretValue
    }

    // For auth fields, missing secrets should cause failure
    if (isAuth) {
      throw new Error(`Missing required secret: ${secretName}`)
    }

    // For headers, fallback to placeholder
    return match
  })
}

/**
 * Validates that a string contains secret placeholders
 */
export function hasSecretPlaceholders(value: string): boolean {
  return new RegExp(SECRET_PATTERN.source).test(value)
}

/**
 * Extracts all secret names from a string
 */
export function extractSecretNames(value: string): string[] {
  const secretNames: string[] = []
  let match

  // Reset regex state
  SECRET_PATTERN.lastIndex = 0

  while ((match = SECRET_PATTERN.exec(value)) !== null) {
    secretNames.push(match[1])
  }

  // Reset regex state again
  SECRET_PATTERN.lastIndex = 0

  return secretNames
}

/**
 * Checks if all required secrets are available in the environment
 */
export function validateSecretsAvailable(secretNames: string[], env: Env): boolean {
  return secretNames.every((secretName) => env[secretName] !== undefined)
}

/**
 * Processes a server configuration by interpolating secrets in authConfigs and headers.
 */
export function processServerConfig(config: ServerConfig, env: Env): ServerConfig {
  const processedConfig = { ...config }

  // Process authConfigs. Type-guard malformed entries: a raw TypeError must
  // never reach the client; invalid shapes fail validation with a generic
  // error instead.
  if (processedConfig.authConfigs !== undefined) {
    if (!Array.isArray(processedConfig.authConfigs)) {
      throw new TypeError('authConfigs must be an array')
    }
    processedConfig.authConfigs = processedConfig.authConfigs.map((config): AuthConfig => {
      if (
        config === null ||
        typeof config !== 'object' ||
        typeof (config as { header?: unknown }).header !== 'string' ||
        typeof (config as { value?: unknown }).value !== 'string'
      ) {
        throw new TypeError('authConfigs entries must have string header and value fields')
      }
      return {
        header: config.header,
        value: interpolateSecret(config.value, env, true),
      }
    })
  }

  // Process headers
  if (processedConfig.headers) {
    processedConfig.headers = Object.fromEntries(
      Object.entries(processedConfig.headers).map(([key, value]) => [
        key,
        interpolateSecret(value, env, false),
      ]),
    )
  }

  return processedConfig
}

/**
 * Processes global auth configuration by interpolating secrets in auth configs.
 */
export function processGlobalAuthConfigs(configs: AuthConfig[], env: Env): AuthConfig[] {
  return configs.map((config): AuthConfig => {
    if (
      config === null ||
      typeof config !== 'object' ||
      typeof (config as { header?: unknown }).header !== 'string' ||
      typeof (config as { value?: unknown }).value !== 'string'
    ) {
      throw new TypeError('Global auth entries must have string header and value fields')
    }
    return {
      header: config.header,
      value: interpolateSecret(config.value, env, true),
    }
  })
}
