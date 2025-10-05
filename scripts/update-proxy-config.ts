import { execSync } from 'child_process'
import { createInterface } from 'readline'
import * as crypto from 'crypto'
import { ServerConfig } from '../src/types'


let currentConfig: Record<string, ServerConfig> = {}
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

function runWrangler(cmd: string): string {
  try {
    let output = execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).toString().trim()
    return output
  } catch (error) {
    let stdout = '';
    let stderr = '';
    if (error instanceof Error) {
      if (typeof (error as any).stdout === 'string') {
        stdout = (error as any).stdout.toString().trim();
      } else if ((error as any).stdout) {
        stdout = (error as any).stdout.toString().trim();
      }
      if ((error as any).stderr) {
        stderr = (error as any).stderr.toString().trim();
      }
    }
    return `${stdout}\n${stderr}`.trim() || '';
  }
}

function loadAllConfigs(): Record<string, ServerConfig> {
  let config: Record<string, ServerConfig> = {}
  try {
    const listOutput = runWrangler(`wrangler kv key list --binding=PROXY_SERVERS --remote -c wrangler.toml`)
    if (listOutput) {
      const listData = JSON.parse(listOutput)
      const keys = Array.isArray(listData) ? listData : [];
      for (const kvKey of keys) {
        const keyName = kvKey.name
        const data = runWrangler(`wrangler kv key get "${keyName}" --binding=PROXY_SERVERS --remote -c wrangler.toml`)
        if (data) {
          try {
            config[keyName] = JSON.parse(data)
          } catch (e) {
            console.log(`Failed to parse config for ${keyName}:`, e)
          }
        }
      }
    }
  } catch (e) {
    console.log('Failed to load existing configs:', e)
  }
  return config
}

function saveSingleConfig(id: string, config: ServerConfig): void {
  try {
    const configJson = JSON.stringify(config, null, 2)
    const tempDir = os.tmpdir()
    const tempFile = path.join(tempDir, `proxy-config-${id}-${Date.now()}.json`)
    fs.writeFileSync(tempFile, configJson)

    try {
      const output = runWrangler(`wrangler kv key put "${id}" --binding=PROXY_SERVERS --path="${tempFile}" --remote`)
      if (output && output.includes('error')) {
        console.error(`Save failed for ${id}:`, output)
      } else {
        console.log(`Saved config for ${id} to KV.`)
      }
    } finally {
      try {
        fs.unlinkSync(tempFile)
      } catch (unlinkErr) {
        console.warn(`Failed to delete temp file ${tempFile}:`, unlinkErr)
      }
    }
  } catch (e) {
    console.error(`Failed to save config for ${id}:`, e)
  }
}

function deleteSingleConfig(id: string): void {
  try {
    const output = runWrangler(`wrangler kv key delete "${id}" --binding=PROXY_SERVERS --remote`)
    if (output && output.includes('error')) {
      console.error(`Delete failed for ${id}:`, output)
    } else {
      console.log(`Deleted config for ${id} from KV.`)
    }
  } catch (e) {
    console.error(`Failed to delete config for ${id}:`, e)
  }
}

function saveSecret(secretName: string, value: string): boolean {
  try {
    const cmd = `wrangler secret put "${secretName}"`
    execSync(cmd, { input: `${value}\n`, stdio: 'pipe', encoding: 'utf-8' })
    console.log(`Saved secret ${secretName} to Cloudflare.`)
    return true
  } catch (e) {
    console.error(`Failed to save secret ${secretName}:`, e)
    return false
  }
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
})

async function askQuestion(question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

// Export functions for testing
export { runWrangler, loadAllConfigs, saveSingleConfig, deleteSingleConfig, saveSecret, askQuestion }

currentConfig = loadAllConfigs()
console.log(`Loaded ${Object.keys(currentConfig).length} existing configurations.`)

async function addEntry() {
  const id = (await askQuestion('Enter new proxy ID: ')).trim()
  if (!id) {
    console.log('ID cannot be empty.')
    return
  }
  if (currentConfig[id]) {
    console.log('ID already exists. Use modify instead.')
    return
  }

  const url = (await askQuestion('Enter downstream URL (must be HTTPS): ')).trim()
  if (!url || !url.startsWith('https://')) {
    console.log('Valid HTTPS URL required.')
    return
  }

  const needsAuthInput = (await askQuestion('Does it need auth? (y/n): ')).toLowerCase().trim()
  const needsAuth = needsAuthInput === 'y'
  let auth: string | undefined

  if (needsAuth) {
    const authChoice = (await askQuestion('Choose auth type:\n1. Manual entry (use ${SECRET_NAME} placeholders)\n2. Auto-generate token and save as secret\nEnter choice (1 or 2): ')).trim()

    if (authChoice === '2') {
      // Auto-generate secure random token and save as secret
      const token = crypto.randomBytes(32).toString('hex')
      const secretName = `${id}_AUTH_TOKEN`
      console.log(`Generated auth token: ${token}`)
      const confirm = (await askQuestion('Save this token as a secret? (y/n): ')).toLowerCase().trim()
      if (confirm === 'y') {
        console.log(`Saving auth token for ${id} as secret ${secretName}...`)
        if (saveSecret(secretName, token)) {
          auth = `Bearer \${${secretName}}`
          console.log(`Auth set to: Bearer [${secretName}] (token saved securely).`)
        } else {
          console.log('Failed to save secret; proceeding without auth.')
        }
      } else {
        console.log('Token not saved.')
      }
    } else {
      // Manual entry
      auth = (await askQuestion("Enter auth header value (e.g., 'Bearer ${API_TOKEN}', empty for none): ")).trim()
      if (!auth) {
        console.log('No auth set.')
        auth = undefined
      } else {
        console.log(`Auth set to: ${auth.includes('${') ? auth : '[value - consider using ${SECRET_NAME} placeholder]'}`)
      }
    }
  }

  const needsHeadersInput = (await askQuestion('Add downstream headers? (y/n): ')).toLowerCase().trim()
  const needsHeaders = needsHeadersInput === 'y'
  let headers: Record<string, string> = {}

  if (needsHeaders) {
    console.log('Remember: For sensitive values, use placeholders like "${SECRET_NAME}". Set secrets with "wrangler secret put SECRET_NAME"')
    const headersStr = await askQuestion('Enter headers as JSON object (e.g., {"X-Key": "value", "Authorization": "Bearer ${TOKEN}"}): ')
    try {
      headers = JSON.parse(headersStr)
      if (typeof headers !== 'object' || Array.isArray(headers) || headers === null) {
        throw new Error('Headers must be a plain object.')
      }
    } catch (e) {
      console.log('Invalid JSON for headers:', (e as Error).message)
      return
    }
  }

  const newConfig: ServerConfig = { url }
  if (auth) newConfig.auth = auth
  if (Object.keys(headers).length > 0) newConfig.headers = headers

  currentConfig[id] = newConfig
  saveSingleConfig(id, newConfig)
  console.log(`Added entry for ${id}.`)
}

async function modifyEntry() {
  const ids = Object.keys(currentConfig)
  if (ids.length === 0) {
    console.log('No existing entries to modify.')
    return
  }

  console.log('Available IDs:', ids.join(', '))
  const id = (await askQuestion('Enter proxy ID to modify: ')).trim()
  if (!currentConfig[id]) {
    console.log('ID not found.')
    return
  }

  const config = currentConfig[id]

  let newUrl = (await askQuestion(`Enter new URL (current: ${config.url}, enter to keep): `)).trim()
  if (!newUrl) newUrl = config.url

  const currentAuth = config.auth ? (config.auth.includes('${') ? config.auth : '[sensitive value - migrate to ${SECRET_NAME}]') : 'none'
  const changeAuthInput = (await askQuestion(`Change auth? (current: ${currentAuth}) (y/n): `)).toLowerCase().trim()
  let auth = config.auth

  if (changeAuthInput === 'y') {
    const authChoice = (await askQuestion('Choose auth option:\n1. Manual entry\n2. Remove auth\n3. Auto-generate new token\nEnter choice (1, 2, or 3): ')).trim()

    if (authChoice === '2') {
      auth = undefined
      console.log('Auth removed.')
    } else if (authChoice === '3') {
      const token = crypto.randomBytes(32).toString('hex')
      const secretName = `${id}_AUTH_TOKEN`
      console.log(`Generated new auth token: ${token}`)
      const confirm = (await askQuestion('Save this new token as a secret? (y/n): ')).toLowerCase().trim()
      if (confirm === 'y') {
        console.log(`Saving new auth token for ${id} as secret ${secretName}...`)
        if (saveSecret(secretName, token)) {
          auth = `Bearer \${${secretName}}`
          console.log(`Auth set to: Bearer [${secretName}] (new token saved securely).`)
        } else {
          console.log('Failed to save secret.')
        }
      } else {
        console.log('New token not saved.')
      }
    } else {
      auth = (await askQuestion("Enter new auth header value (e.g., 'Bearer ${API_TOKEN}', empty to remove): ")).trim() || undefined
      if (auth) {
        console.log(`Auth set to: ${auth.includes('${') ? auth : '[value - consider using ${SECRET_NAME} placeholder]'}`)
      }
    }
  }

  let newHeaders = { ...(config.headers || {}) }
  const changeHeadersInput = (await askQuestion('Change headers? (y/n): ')).toLowerCase().trim()

  if (changeHeadersInput === 'y') {
    const currentHeadersStr = JSON.stringify(config.headers || {}, null, 2)
    console.log('Remember: For sensitive values, use placeholders like "${SECRET_NAME}". Set secrets with "wrangler secret put SECRET_NAME"')
    const headersStr = await askQuestion(`Enter new headers as JSON (current: ${currentHeadersStr}, empty to remove all): `)
    if (headersStr.trim()) {
      try {
        newHeaders = JSON.parse(headersStr)
        if (typeof newHeaders !== 'object' || Array.isArray(newHeaders) || newHeaders === null) {
          throw new Error('Headers must be a plain object.')
        }
      } catch (e) {
        console.log('Invalid JSON for headers:', (e as Error).message)
        return
      }
    } else {
      newHeaders = {}
    }
  }

  const updatedConfig: ServerConfig = { url: newUrl }
  if (auth) updatedConfig.auth = auth
  if (Object.keys(newHeaders).length > 0) updatedConfig.headers = newHeaders

  currentConfig[id] = updatedConfig
  saveSingleConfig(id, updatedConfig)
  console.log(`Modified entry for ${id}.`)
}

async function deleteEntry() {
  const ids = Object.keys(currentConfig)
  if (ids.length === 0) {
    console.log('No existing entries to delete.')
    return
  }

  console.log('Available IDs:', ids.join(', '))
  const id = (await askQuestion('Enter proxy ID to delete: ')).trim()
  if (!currentConfig[id]) {
    console.log('ID not found.')
    return
  }

  const confirm = (await askQuestion(`Confirm delete ${id}? (y/n): `)).toLowerCase().trim()
  if (confirm === 'y') {
    delete currentConfig[id]
    deleteSingleConfig(id)
    console.log(`Deleted entry for ${id}.`)
  } else {
    console.log('Delete cancelled.')
  }
}

async function main() {
  console.log('Current configuration:')
  console.log(JSON.stringify(currentConfig, null, 2))
  console.log('\n')

  let action = (await askQuestion('What do you want to do? (a)dd, (m)odify, (d)elete, (q)uit: ')).toLowerCase().trim()

  while (action !== 'q') {
    if (action === 'a') {
      await addEntry()
    } else if (action === 'm') {
      await modifyEntry()
    } else if (action === 'd') {
      await deleteEntry()
    } else {
      console.log('Invalid action.')
    }

    console.log('\nCurrent configuration:')
    console.log(JSON.stringify(currentConfig, null, 2))
    console.log('\n')
    action = (await askQuestion('Another action? (a/m/d/q): ')).toLowerCase().trim()
  }

  rl.close()
}

main().catch(console.error)
