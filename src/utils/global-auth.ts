import { Env, AuthConfig } from '../types';
import { validateAuthConfigs } from '../config-validator';
import { processGlobalAuthConfigs } from '../secret-interpolation';

/**
 * Result of global auth configuration loading
 */
export interface GlobalAuthResult {
  configs: AuthConfig[]
  hasGlobalAuth: boolean
  error?: string
}

/**
 * Parses global auth configuration from a JSON string
 */
function parseGlobalAuthConfig(configJson: string): GlobalAuthResult {
  try {
    const configs = JSON.parse(configJson) as AuthConfig[];

    // Validate the configuration
    const validation = validateAuthConfigs(configs);
    if (!validation.isValid) {
      return {
        configs: [],
        hasGlobalAuth: false,
        error: `Global auth configuration invalid: ${validation.error?.message}`
      };
    }

    return {
      configs,
      hasGlobalAuth: true
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      configs: [],
      hasGlobalAuth: false,
      error: `Failed to parse global auth configuration: ${errorMessage}`
    };
  }
}

/**
 * Loads global auth configuration from environment variables
 */
export async function loadGlobalAuthFromEnv(env: Env): Promise<GlobalAuthResult> {
  const globalAuthConfig = env.GLOBAL_AUTH_CONFIGS;

  if (!globalAuthConfig) {
    return {
      configs: [],
      hasGlobalAuth: false
    };
  }

  return parseGlobalAuthConfig(globalAuthConfig);
}

/**
 * Loads global auth configuration from KV storage (fallback)
 */
export async function loadGlobalAuthFromKV(env: Env): Promise<GlobalAuthResult> {
  try {
    const globalAuthConfig = await env.PROXY_SERVERS.get('global-auth-configs');

    if (!globalAuthConfig) {
      return {
        configs: [],
        hasGlobalAuth: false
      };
    }

    // Only attempt to parse if it's a string
    if (typeof globalAuthConfig !== 'string') {
      return {
        configs: [],
        hasGlobalAuth: false
      };
    }

    return parseGlobalAuthConfig(globalAuthConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      configs: [],
      hasGlobalAuth: false,
      error: `Failed to load global auth from KV: ${errorMessage}`
    };
  }
}

/**
 * Loads global auth configuration with fallback logic and secret interpolation
 * First tries environment variables, then falls back to KV storage
 */
export async function loadGlobalAuthConfiguration(env: Env): Promise<GlobalAuthResult> {
  // Try environment variables first
  const envResult = await loadGlobalAuthFromEnv(env);
  if (envResult.hasGlobalAuth) {
    // Process secret interpolation
    try {
      const processedConfigs = processGlobalAuthConfigs(envResult.configs, env);
      return {
        ...envResult,
        configs: processedConfigs
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        configs: [],
        hasGlobalAuth: false,
        error: `Global auth secret interpolation failed: ${errorMessage}`
      };
    }
  }

  // Fall back to KV storage
  const kvResult = await loadGlobalAuthFromKV(env);
  if (kvResult.hasGlobalAuth) {
    // Process secret interpolation
    try {
      const processedConfigs = processGlobalAuthConfigs(kvResult.configs, env);
      return {
        ...kvResult,
        configs: processedConfigs
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        configs: [],
        hasGlobalAuth: false,
        error: `Global auth secret interpolation failed: ${errorMessage}`
      };
    }
  }

  return kvResult;
}

/**
 * Checks if the incoming request has valid global authentication
 */
export function checkGlobalAuth(request: Request, globalAuthConfigs: AuthConfig[]): boolean {
  // Allow access if no global auth has been configured
  if (globalAuthConfigs.length === 0) {
    return true;
  }

  // Check if any global auth header matches (any one match is sufficient)
  const hasValidMatch = globalAuthConfigs.some(config => {
    const headerValue = request.headers.get(config.header);
    if (!headerValue) return false;
    return headerValue === config.value;
  });

  return hasValidMatch;
}