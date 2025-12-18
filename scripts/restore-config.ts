import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function runWrangler(cmd: string): string {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).toString().trim();
  } catch (error) {
    if (error instanceof Error) {
        const stderr = (error as any).stderr?.toString().trim();
        if (stderr) console.error(stderr);
    }
    throw error;
  }
}

async function restore() {
  const backupFile = process.argv[2];
  if (!backupFile) {
    console.error('Usage: bun run scripts/restore-config.ts <backup-file.json>');
    process.exit(1);
  }

  if (!fs.existsSync(backupFile)) {
    console.error(`Backup file not found: ${backupFile}`);
    process.exit(1);
  }

  console.log(`Restoring KV PROXY_SERVERS from ${backupFile}...`);

  try {
    const data = fs.readFileSync(backupFile, 'utf-8');
    const backupData = JSON.parse(data);
    const entries = Object.entries(backupData);

    console.log(`Found ${entries.length} entries to restore.`);

    for (const [key, value] of entries) {
      process.stdout.write(`Restoring ${key}... `);
      
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      
      // Write to temp file to avoid quoting issues
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `restore-${Date.now()}-${Math.random().toString(36).substring(7)}.json`);
      fs.writeFileSync(tempFile, stringValue);

      try {
        runWrangler(`wrangler kv key put "${key}" --binding=PROXY_SERVERS --remote -c wrangler.toml --path="${tempFile}"`);
        console.log('Done.');
      } catch (e) {
        console.log('Failed.');
        throw e;
      } finally {
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
      }
    }

    console.log('\nRestore complete!');

  } catch (error) {
    console.error('\nRestore failed:', error);
    process.exit(1);
  }
}

restore();
