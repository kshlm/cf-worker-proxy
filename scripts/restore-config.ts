import * as fs from 'fs'
import * as readline from 'readline'
import {
  runWrangler,
  parseKeyList,
  writeTempFile,
  cleanupTempFile,
  isValidRouteId,
  GLOBAL_AUTH_KV_KEY,
} from './wrangler'
import { validateProcessedConfig } from '../src/config-validator'
import { ServerConfig } from '../src/types'

export interface RestoreOptions {
  /** Skip interactive confirmation (reserved-key overwrite and --replace still need more) */
  yes?: boolean
  /** Validate only; no remote writes */
  dryRun?: boolean
  /** Prune remote keys not present in the backup */
  replace?: boolean
  /** Strong confirmation for --replace pruning (in addition to yes) */
  confirmReplace?: boolean
}

export interface RestoreResult {
  restored: string[]
  failed: { key: string; error: string }[]
  pruned: string[]
}

async function confirmOverwrite(key: string): Promise<boolean> {
  console.log(`WARNING: key "${key}" is reserved for global authentication.`)
  console.log('Overwriting it changes authentication for every route in this worker.')
  console.log('Type the key name in full to confirm overwrite:')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise<boolean>((resolve) => {
    rl.question('> ', (answer) => {
      rl.close()
      resolve(answer.trim() === key)
    })
  })
}

interface LoadedBackup {
  entries: Record<string, unknown>
}

/** Accepts versioned documents and legacy bare maps; returns entries or throws. */
function loadBackup(raw: string): LoadedBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Backup file is not valid JSON')
  }

  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as { version?: unknown }).version === 1 &&
    typeof (parsed as { entries?: unknown }).entries === 'object' &&
    (parsed as { entries?: unknown }).entries !== null
  ) {
    return { entries: (parsed as { entries: Record<string, unknown> }).entries }
  }

  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return { entries: parsed as Record<string, unknown> } // legacy bare map
  }

  throw new Error('Backup file has an unrecognized structure')
}

/**
 * Restores a backup into the PROXY_SERVERS KV namespace.
 *
 * Semantics:
 * - The ENTIRE backup is validated before the first remote write.
 * - Default is merge: only keys present in the backup are written.
 * - --replace (with strong confirmation) additionally prunes remote keys
 *   absent from the backup.
 * - Failures on individual keys are collected and reported; other keys
 *   still restore. The overall run fails if any key failed.
 */
export async function restore(
  backupFile?: string,
  opts: RestoreOptions = {},
): Promise<RestoreResult> {
  if (!backupFile) {
    throw new Error(
      'Usage: bun run restore-config <backup-file.json> [--dry-run] [--yes] [--replace [--confirm-prune]]',
    )
  }
  if (!fs.existsSync(backupFile)) {
    throw new Error(`Backup file not found: ${backupFile}`)
  }

  const { entries } = loadBackup(fs.readFileSync(backupFile, 'utf-8'))
  const keys = Object.keys(entries)

  // ---- Phase 1: validate everything before any remote write ----
  const validationErrors: { key: string; error: string }[] = []
  for (const key of keys) {
    if (!isValidRouteId(key) && key !== GLOBAL_AUTH_KV_KEY) {
      validationErrors.push({ key, error: 'key is not a valid route id' })
      continue
    }
    const value = entries[key]
    if (key === GLOBAL_AUTH_KV_KEY) {
      // Reserved key must parse as a JSON string containing auth configs;
      // full structural validation happens server-side at load time, but we
      // at least require it to be a JSON-serializable array.
      if (typeof value === 'string') {
        try {
          if (!Array.isArray(JSON.parse(value))) {
            validationErrors.push({ key, error: 'global auth value must be a JSON array' })
          }
        } catch {
          validationErrors.push({ key, error: 'global auth value must be a JSON array' })
        }
      } else if (!Array.isArray(value)) {
        validationErrors.push({ key, error: 'global auth value must be a JSON array' })
      }
      continue
    }
    // Route configs: full runtime validation against the stored value.
    // String-valued entries are parsed first so a raw KV string round-trips
    // through the same validation as object entries.
    let configValue: unknown = value
    if (typeof value === 'string') {
      // A string that parses as JSON is treated as a serialized config and
      // must pass the shared validator; non-JSON strings are raw KV values
      // preserved verbatim.
      let parsedString: unknown = null
      let isJson = false
      try {
        parsedString = JSON.parse(value)
        isJson = true
      } catch {
        isJson = false
      }
      if (isJson) {
        if (
          parsedString === null ||
          typeof parsedString !== 'object' ||
          Array.isArray(parsedString)
        ) {
          validationErrors.push({
            key,
            error: 'JSON string entry must be a server configuration object',
          })
          continue
        }
        const parsedValidation = validateProcessedConfig(parsedString as ServerConfig)
        if (!parsedValidation.isValid) {
          validationErrors.push({
            key,
            error: parsedValidation.error?.message || 'invalid configuration',
          })
        }
        continue
      }
      // non-JSON raw string: preserved verbatim, nothing to validate
      continue
    }
    if (configValue === null || typeof configValue !== 'object' || Array.isArray(configValue)) {
      validationErrors.push({ key, error: 'entry must be a server configuration object' })
      continue
    }
    const validation = validateProcessedConfig(configValue as ServerConfig)
    if (!validation.isValid) {
      validationErrors.push({ key, error: validation.error?.message || 'invalid configuration' })
    }
  }
  if (validationErrors.length > 0) {
    for (const { key, error } of validationErrors) {
      console.error(`Validation failed for ${key}: ${error}`)
    }
    throw new Error(
      `Backup validation failed for ${validationErrors.length} entr${validationErrors.length === 1 ? 'y' : 'ies'}; nothing was written`,
    )
  }

  if (opts.dryRun) {
    console.log(`Dry run: ${keys.length} entries validated successfully, no remote writes.`)
    return { restored: [], failed: [], pruned: [] }
  }

  // ---- Phase 2: explicit confirmation ----
  // Reserved-key overwrite and --replace pruning need typed confirmation
  // beyond --yes; other keys are covered by --yes or one interactive ack.
  const touchesReserved = keys.includes(GLOBAL_AUTH_KV_KEY)
  if (!opts.yes && !process.stdin.isTTY && !opts.dryRun) {
    throw new Error(
      'Refusing to restore without confirmation: pass --yes after reviewing the backup',
    )
  }
  if (!opts.yes && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer: string = await new Promise((resolve) => {
      rl.question(
        `Restore ${keys.length} entr${keys.length === 1 ? 'y' : 'ies'} to remote KV? (y/n): `,
        resolve,
      )
    })
    rl.close()
    if (answer.trim().toLowerCase() !== 'y') {
      throw new Error('Restore cancelled: no confirmation given')
    }
  }
  if (touchesReserved && !opts.dryRun) {
    const ok = await confirmOverwrite(GLOBAL_AUTH_KV_KEY)
    if (!ok) {
      throw new Error(
        `Restore cancelled: confirmation for ${GLOBAL_AUTH_KV_KEY} overwrite not given`,
      )
    }
  }

  // ---- Phase 3: optional prune requires strong confirmation BEFORE any writes ----
  if (opts.replace && !opts.confirmReplace) {
    throw new Error(
      'Refusing to prune without strong confirmation (pass confirmReplace after reviewing keys)',
    )
  }

  // ---- Phase 4: restore key by key, collecting failures ----
  const restored: string[] = []
  const failed: { key: string; error: string }[] = []

  for (const key of keys) {
    process.stdout.write(`Restoring ${key}... `)
    let tempFile: string | null = null
    try {
      const value = entries[key]
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
      tempFile = writeTempFile('restore-put-', stringValue)
      runWrangler(['kv', 'key', 'put', key, '--binding=PROXY_SERVERS', '--path', tempFile])
      console.log('Done.')
      restored.push(key)
    } catch (error) {
      console.log('Failed.')
      failed.push({ key, error: error instanceof Error ? error.message : String(error) })
    } finally {
      cleanupTempFile(tempFile)
    }
  }

  // ---- Phase 5: optional prune ----
  const pruned: string[] = []
  if (opts.replace) {
    const listOutput = runWrangler(['kv', 'key', 'list', '--binding=PROXY_SERVERS'])
    const remoteKeys = parseKeyList(listOutput).map((k) => k.name)
    for (const key of remoteKeys) {
      if (keys.includes(key)) continue
      // The reserved global auth key is never pruned: it holds auth config,
      // not a route, and it is not part of the backup's route entries.
      if (key === GLOBAL_AUTH_KV_KEY) continue
      process.stdout.write(`Pruning ${key}... `)
      try {
        runWrangler(['kv', 'key', 'delete', key, '--binding=PROXY_SERVERS'])
        console.log('Done.')
        pruned.push(key)
      } catch (error) {
        console.log('Failed.')
        failed.push({ key, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  console.log(
    `\nRestore finished: ${restored.length} restored, ${failed.length} failed, ${pruned.length} pruned.`,
  )
  for (const { key, error } of failed) {
    console.error(`Failed: ${key}: ${error}`)
  }

  // Partial failures are reported; the CLI entry point turns a non-empty
  // failed list into a nonzero exit code.
  return { restored, failed, pruned }
}

if (process.argv[1] && process.argv[1].endsWith('restore-config.ts') && !process.env.VITEST) {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  restore(file, {
    dryRun: args.includes('--dry-run'),
    yes: args.includes('--yes'),
    replace: args.includes('--replace'),
    confirmReplace: args.includes('--confirm-prune'),
  })
    .then((result) => {
      if (result.failed.length > 0) {
        process.exit(1)
      }
    })
    .catch((error: unknown) => {
      console.error('Restore failed:', error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
