import { Env, AuthConfig } from '../types';
import { validateAuthConfigs } from '../config-validator';
import { processGlobalAuthConfigs } from '../secret-interpolation';

/**
 * KV key reserved for global auth configuration. It is not a valid
 * server route key: requests routed to it must never resolve.
 */
export const GLOBAL_AUTH_KV_KEY = 'global-auth-configs';

/**
 * Load state of the global auth configuration source:
 * - absent: no source exists anywhere; global auth is off
 * - configured: a source exists and parsed/validated cleanly
 * - error: a source exists but could not be loaded, parsed, or validated
 */
export type GlobalAuthState = 'absent' | 'configured' | 'error';

export interface GlobalAuthResult {
  state: GlobalAuthState
  configs: AuthConfig[]
  error?: string
}

/**
 * Parses a global auth JSON string. Any parse or validation failure is an
 * error result, never a silent downgrade to "not configured".
 */
function parseGlobalAuthConfig(configJson: string): GlobalAuthResult {
  try {
    const configs = JSON.parse(configJson) as AuthConfig[];

    const validation = validateAuthConfigs(configs);
    if (!validation.isValid) {
      return {
        state: 'error',
        configs: [],
        error: `Global auth configuration invalid: ${validation.error?.message}`
      };
    }

    return {
      state: 'configured',
      configs
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      state: 'error',
      configs: [],
      error: `Failed to parse global auth configuration: ${errorMessage}`
    };
  }
}

/**
 * Loads global auth configuration from the environment variable.
 * A present variable — even an empty array — counts as configured.
 */
export async function loadGlobalAuthFromEnv(env: Env): Promise<GlobalAuthResult> {
  const globalAuthConfig = env.GLOBAL_AUTH_CONFIGS;

  if (globalAuthConfig === undefined) {
    return { state: 'absent', configs: [] };
  }

  return parseGlobalAuthConfig(globalAuthConfig);
}

/**
 * Loads global auth configuration from KV storage (fallback when the
 * environment variable is absent).
 */
export async function loadGlobalAuthFromKV(env: Env): Promise<GlobalAuthResult> {
  try {
    const globalAuthConfig = await env.PROXY_SERVERS.get(GLOBAL_AUTH_KV_KEY);

    if (globalAuthConfig === null || globalAuthConfig === undefined) {
      return { state: 'absent', configs: [] };
    }

    return parseGlobalAuthConfig(globalAuthConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      state: 'error',
      configs: [],
      error: `Failed to load global auth from KV: ${errorMessage}`
    };
  }
}

/**
 * Loads global auth configuration with fallback logic and secret
 * interpolation. Environment variable first, KV storage as fallback.
 * A present-but-broken source is an error result: the caller must fail
 * closed rather than treat global auth as unconfigured.
 */
export async function loadGlobalAuthConfiguration(env: Env): Promise<GlobalAuthResult> {
  const envResult = await loadGlobalAuthFromEnv(env);
  if (envResult.state === 'configured') {
    return interpolateResult(envResult, env);
  }
  if (envResult.state === 'error') {
    return envResult;
  }

  const kvResult = await loadGlobalAuthFromKV(env);
  if (kvResult.state === 'configured') {
    return interpolateResult(kvResult, env);
  }
  return kvResult;
}

function interpolateResult(result: GlobalAuthResult, env: Env): GlobalAuthResult {
  try {
    return {
      ...result,
      configs: processGlobalAuthConfigs(result.configs, env)
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      state: 'error',
      configs: [],
      error: `Global auth secret interpolation failed: ${errorMessage}`
    };
  }
}

/**
 * Checks the incoming request against global auth configs using
 * "any one match" logic. Only called when global auth is configured.
 */
export function checkGlobalAuth(request: Request, globalAuthConfigs: AuthConfig[]): boolean {
  if (globalAuthConfigs.length === 0) {
    return false;
  }

  return globalAuthConfigs.some(config => {
    const headerValue = request.headers.get(config.header);
    if (!headerValue) return false;
    return headerValue === config.value;
  });
}
