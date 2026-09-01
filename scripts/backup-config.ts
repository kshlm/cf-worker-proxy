import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { runWrangler, parseKeyList } from './wrangler';

const BACKUP_DIR = 'backups';

interface BackupDocument {
  version: 1;
  exportedAt: string;
  entries: Record<string, unknown>;
}

/**
 * Fetches all PROXY_SERVERS KV entries and writes a versioned backup
 * document. Raw KV values are preserved verbatim. The file is written
 * atomically (temp file + rename) with 0600 permissions, and an existing
 * backup file is never overwritten.
 */
export async function backup(dir: string = BACKUP_DIR): Promise<string> {
  const listOutput = runWrangler(['kv', 'key', 'list', '--binding=PROXY_SERVERS']);
  const keys = parseKeyList(listOutput);

  const entries: Record<string, unknown> = {};
  for (const key of keys) {
    process.stdout.write(`Fetching ${key.name}... `);
    const raw = runWrangler(['kv', 'key', 'get', key.name, '--binding=PROXY_SERVERS']);
    try {
      entries[key.name] = JSON.parse(raw);
    } catch {
      entries[key.name] = raw; // preserve raw string values verbatim
    }
    console.log('Done.');
  }

  const doc: BackupDocument = {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries
  };

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Unique timestamped name (millisecond precision + random suffix); never overwrite.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const unique = `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
  const target = path.join(dir, `proxy-config-backup-${unique}.json`);
  if (fs.existsSync(target)) {
    throw new Error(`Backup file already exists, refusing to overwrite: ${target}`);
  }

  const json = JSON.stringify(doc, null, 2);
  const tempFile = path.join(dir, `.${path.basename(target)}.${crypto.randomBytes(3).toString('hex')}.tmp`);
  fs.writeFileSync(tempFile, json, { mode: 0o600 });
  fs.renameSync(tempFile, target);

  console.log(`Backup complete: ${Object.keys(entries).length} entries -> ${target}`);
  return target;
}

if (process.argv[1] && process.argv[1].endsWith('backup-config.ts')) {
  backup().catch((error: unknown) => {
    console.error('Backup failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
