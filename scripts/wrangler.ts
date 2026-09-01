import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { GLOBAL_AUTH_KV_KEY } from '../src/utils/global-auth'

/**
 * Shared Wrangler invocation helper for configuration scripts.
 *
 * - Arguments are passed as an argv array with shell: false, so shell
 *   metacharacters in user-controlled values (KV key names, etc.) cannot
 *   be interpreted by a shell.
 * - The wrangler config file is always explicit, so a stray local
 *   .wrangler state or wrong environment cannot be hit.
 * - The remote/local target flag is command-appropriate: `secret put`
 *   has no --remote flag, so only KV commands get --remote.
 * - Nonzero exits throw, so callers cannot mistake failure for success.
 */
export function runWrangler(args: string[], opts: { input?: string } = {}): string {
  const isSecretCommand = args[0] === 'secret'
  const targetFlag = isSecretCommand ? [] : ['--remote']
  const fullArgs = [...args, ...targetFlag, '--config', 'wrangler.toml']
  const output = execFileSync('wrangler', fullArgs, {
    encoding: 'utf-8',
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(opts.input !== undefined ? { input: opts.input } : {}),
  })
  return output.trim()
}

/**
 * Route IDs are KV keys that map to server configs. Restrict them to a
 * conservative safe set and reject the reserved global auth key.
 */
export { GLOBAL_AUTH_KV_KEY }

const MAX_ROUTE_ID_LENGTH = 64

export function isValidRouteId(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ROUTE_ID_LENGTH) {
    return false
  }
  if (id === GLOBAL_AUTH_KV_KEY) {
    return false
  }
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)
}

/**
 * Parses a KV key list response. Malformed output is a hard failure so the
 * caller never mistakes it for an empty namespace.
 */
export function parseKeyList(output: string): { name: string }[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    throw new Error(`KV key list returned malformed JSON: ${output.slice(0, 200)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error('KV key list returned malformed output: expected an array')
  }
  for (const [index, entry] of parsed.entries()) {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof (entry as { name?: unknown }).name !== 'string'
    ) {
      throw new Error(`KV key list returned malformed entry at index ${index}`)
    }
  }
  return parsed as { name: string }[]
}

export { isValidHeaderName } from '../src/utils/auth-helpers'

/**
 * Writes data to a uniquely named temp file created with 0600 permissions
 * and returns its path. Caller is responsible for cleanup.
 */
export function writeTempFile(prefix: string, data: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const file = path.join(dir, 'value.json')
  fs.writeFileSync(file, data, { mode: 0o600 })
  return file
}

/**
 * Removes a temp file and its parent temp directory (created by
 * writeTempFile). Safe to call with null; never throws.
 */
export function cleanupTempFile(file: string | null): void {
  if (!file) return
  try {
    fs.unlinkSync(file)
    fs.rmdirSync(path.dirname(file))
  } catch {
    // best effort cleanup
  }
}
