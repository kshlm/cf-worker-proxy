import { execSync } from 'child_process';
import * as fs from 'fs';

function runWrangler(cmd: string): string {
  try {
    return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).toString().trim();
  } catch (error) {
    if (error instanceof Error) {
        // wrangler often outputs to stderr
        const stderr = (error as any).stderr?.toString().trim();
        if (stderr) console.error(stderr);
    }
    throw error;
  }
}

async function backup() {
  const backupFile = process.argv[2] || `proxy-config-backup-${new Date().toISOString().slice(0, 10)}.json`;
  console.log(`Backing up KV PROXY_SERVERS to ${backupFile}...`);

  try {
    // List all keys
    console.log('Listing keys...');
    const listOutput = runWrangler('wrangler kv key list --binding=PROXY_SERVERS --remote -c wrangler.toml');
    let keys: { name: string }[] = [];
    try {
        keys = JSON.parse(listOutput);
    } catch (e) {
        console.error('Failed to parse key list:', listOutput);
        throw e;
    }

    if (!Array.isArray(keys)) {
       console.log('No keys found or unexpected format.');
       keys = [];
    }

    const backupData: Record<string, any> = {};

    for (const key of keys) {
      process.stdout.write(`Fetching ${key.name}... `);
      const value = runWrangler(`wrangler kv key get "${key.name}" --binding=PROXY_SERVERS --remote -c wrangler.toml`);
      try {
        backupData[key.name] = JSON.parse(value);
      } catch {
        backupData[key.name] = value; // Keep as string if not valid JSON
      }
      console.log('Done.');
    }

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    console.log(`\nBackup complete! Saved ${keys.length} entries to ${backupFile}`);

  } catch (error) {
    console.error('\nBackup failed:', error);
    process.exit(1);
  }
}

backup();
