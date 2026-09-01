import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Shared Wrangler invocation helper for configuration scripts.
 *
 * - Arguments are passed as an argv array with shell: false, so shell
 *   metacharacters in user-controlled values (KV key names, etc.) cannot
 *   be interpreted by a shell.
 * - The wrangler config file and remote target are always explicit, so a
 *   stray local .wrangler state or wrong environment cannot be hit.
 * - Nonzero exits throw, so callers cannot mistake failure for success.
 */
export function runWrangler(args: string[], opts: { input?: string } = {}): string {
  const fullArgs = [...args, '--config', 'wrangler.toml', '--remote'];
  const output = execFileSync('wrangler', fullArgs, {
    encoding: 'utf-8',
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(opts.input !== undefined ? { input: opts.input } : {})
  });
  return output.trim();
}

/**
 * Route IDs are KV keys that map to server configs. Restrict them to a
 * conservative safe set and reject the reserved global auth key.
 */
export const GLOBAL_AUTH_KV_KEY = 'global-auth-configs';
const MAX_ROUTE_ID_LENGTH = 64;

export function isValidRouteId(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ROUTE_ID_LENGTH) {
    return false;
  }
  if (id === GLOBAL_AUTH_KV_KEY) {
    return false;
  }
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id);
}

/**
 * Parses a KV key list response. Malformed output is a hard failure so the
 * caller never mistakes it for an empty namespace.
 */
export function parseKeyList(output: string): { name: string }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`KV key list returned malformed JSON: ${output.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('KV key list returned malformed output: expected an array');
  }
  return parsed.filter(
    (entry): entry is { name: string } =>
      entry !== null && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string'
  );
}

/**
 * Writes data to a uniquely named temp file created with 0600 permissions
 * and returns its path. Caller is responsible for cleanup.
 */
export function writeTempFile(prefix: string, data: string): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), 'value.json');
  fs.writeFileSync(file, data, { mode: 0o600 });
  return file;
}
