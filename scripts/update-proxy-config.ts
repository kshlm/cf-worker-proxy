import { execSync } from 'child_process'
import { createInterface } from 'readline'
import * as crypto from 'crypto'
import { ServerConfig, AuthConfig } from '../src/types'


let currentConfig: Record<string, ServerConfig> = {}
import * as fs from 'fs'

/**
 * Returns server config as-is (legacy conversion no longer needed)
 */
function convertLegacyToMultiAuth(config: ServerConfig): ServerConfig {
  return config
}
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
            const parsedConfig = JSON.parse(data) as ServerConfig
            // Convert legacy auth to multi-auth format
            config[keyName] = convertLegacyToMultiAuth(parsedConfig)
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
    // Validate authConfigs if present
    const validation = validateAuthConfigs(config.authConfigs)
    if (!validation.isValid) {
      console.error(`Validation failed for ${id}: ${validation.error}`)
      return
    }

    // Clean up config before saving to avoid conflicts
    const cleanedConfig = cleanupConfigForSaving(config)

    const configJson = JSON.stringify(cleanedConfig, null, 2)
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

/**
 * Formats auth configurations for display
 */
function formatAuthConfigs(config: ServerConfig): string {
  if (!config.authConfigs || config.authConfigs.length === 0) {
    return 'No authentication'
  }

  return config.authConfigs.map(auth => {
    const value = auth.value.includes('${')
      ? auth.value.replace(/\$\{[^}]+\}/g, '[$SECRET]')
      : '[sensitive value]'
    return `${auth.header}: ${value}`
  }).join(', ')
}

/**
 * Prompts user to add multiple auth configurations
 */
async function collectAuthConfigs(): Promise<AuthConfig[]> {
  const authConfigs: AuthConfig[] = []

  while (true) {
    console.log(`\n--- Auth Configuration ${authConfigs.length + 1} ---`)

    const headerName = (await askQuestion('Enter header name (e.g., Authorization, X-API-Key): ')).trim()
    if (!headerName) {
      if (authConfigs.length === 0) {
        console.log('At least one auth configuration is required for authentication.')
        continue
      }
      break
    }

    // Validate header name format
    if (!/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(headerName)) {
      console.log('Invalid header name format. Please use valid HTTP header characters.')
      continue
    }

    // Check for duplicate header names
    if (authConfigs.some(config => config.header.toLowerCase() === headerName.toLowerCase())) {
      console.log(`Header "${headerName}" already configured. Please use a different header name.`)
      continue
    }

    const authChoice = (await askQuestion('Choose auth type:\n1. Manual entry (use ${SECRET_NAME} placeholders)\n2. Auto-generate token and save as secret\n3. Auto-generate with custom pattern (use <TOKEN> placeholder)\nEnter choice (1, 2, or 3): ')).trim()

    let authValue: string
    if (authChoice === '2') {
      const token = crypto.randomBytes(32).toString('hex')
      const secretName = `${headerName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`
      console.log(`Generated auth token: ${token}`)
      const confirm = (await askQuestion('Save this token as a secret? (y/n): ')).toLowerCase().trim()
      if (confirm === 'y') {
        console.log(`Saving auth token as secret ${secretName}...`)
        if (saveSecret(secretName, token)) {
          authValue = `Bearer \${${secretName}}`
          console.log(`Auth value set to: Bearer [${secretName}] (token saved securely).`)
        } else {
          console.log('Failed to save secret; using manual entry.')
          authValue = (await askQuestion(`Enter auth header value for "${headerName}": `)).trim()
        }
      } else {
        console.log('Token not saved. Using manual entry.')
        authValue = (await askQuestion(`Enter auth header value for "${headerName}": `)).trim()
      }
    } else if (authChoice === '3') {
      const pattern = (await askQuestion('Enter auth pattern with <TOKEN> placeholder (e.g., "Bearer <TOKEN>", "<TOKEN>", "X-API-Key: <TOKEN>"): ')).trim()
      if (!pattern || !pattern.includes('<TOKEN>')) {
        console.log('Pattern must include <TOKEN> placeholder. Using manual entry.')
        authValue = (await askQuestion(`Enter auth header value for "${headerName}": `)).trim()
      } else {
        const token = crypto.randomBytes(32).toString('hex')
        const secretName = `${headerName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`
        console.log(`Generated auth token: ${token}`)
        const confirm = (await askQuestion('Save this token as a secret? (y/n): ')).toLowerCase().trim()
        if (confirm === 'y') {
          console.log(`Saving auth token as secret ${secretName}...`)
          if (saveSecret(secretName, token)) {
            authValue = pattern.replace('<TOKEN>', `\${${secretName}}`)
            console.log(`Auth value set to: ${authValue.replace(/\$\{[^}]+\}/g, '[$SECRET]')} (token saved securely).`)
          } else {
            console.log('Failed to save secret; using manual entry.')
            authValue = (await askQuestion(`Enter auth header value for "${headerName}": `)).trim()
          }
        } else {
          console.log('Token not saved. Using manual entry.')
          authValue = (await askQuestion(`Enter auth header value for "${headerName}": `)).trim()
        }
      }
    } else {
      authValue = (await askQuestion(`Enter auth header value for "${headerName}": `)).trim()
    }

    if (!authValue) {
      console.log('Auth value cannot be empty.')
      continue
    }

    authConfigs.push({
      header: headerName,
      value: authValue,
    })

    console.log(`Added auth config: ${headerName}`)

    const addMore = (await askQuestion('Add another auth configuration? (y/n): ')).toLowerCase().trim()
    if (addMore !== 'y') {
      break
    }
  }

  return authConfigs
}

/**
 * Allows editing existing auth configurations
 */
async function editAuthConfigs(currentAuthConfigs?: AuthConfig[]): Promise<AuthConfig[]> {
  const authConfigs = [...(currentAuthConfigs || [])]

  while (true) {
    console.log('\n=== Current Authentication Configurations ===')
    if (authConfigs.length === 0) {
      console.log('No authentication configured.')
    } else {
      authConfigs.forEach((config, index) => {
        const value = config.value.includes('${')
          ? config.value.replace(/\$\{[^}]+\}/g, '[$SECRET]')
          : '[sensitive value]'
        console.log(`${index + 1}. ${config.header}: ${value}`)
      })
    }

    const action = (await askQuestion('\nChoose action:\n1. Add auth header\n2. Edit auth header\n3. Delete auth header\n4. Done\nEnter choice (1-4): ')).trim()

    if (action === '1') {
      // Add new auth config
      const newConfigs = await collectAuthConfigs()
      authConfigs.push(...newConfigs)
    } else if (action === '2') {
      // Edit existing auth config
      if (authConfigs.length === 0) {
        console.log('No auth configurations to edit.')
        continue
      }
      const index = parseInt(await askQuestion(`Enter auth config number to edit (1-${authConfigs.length}): `))
      if (isNaN(index) || index < 1 || index > authConfigs.length) {
        console.log('Invalid selection.')
        continue
      }

      const config = authConfigs[index - 1]
      console.log(`\nEditing: ${config.header}`)

      const newHeader = (await askQuestion(`Header name (${config.header}): `)).trim()
      if (newHeader && newHeader !== config.header) {
        if (!/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(newHeader)) {
          console.log('Invalid header name format. Keeping original.')
        } else if (authConfigs.some((c, i) => i !== index - 1 && c.header.toLowerCase() === newHeader.toLowerCase())) {
          console.log(`Header "${newHeader}" already exists. Keeping original.`)
        } else {
          config.header = newHeader
        }
      }

      const newValue = (await askQuestion(`Auth value (current: ${config.value.includes('${') ? config.value.replace(/\$\{[^}]+\}/g, '[$SECRET]') : '[sensitive value]'}): `)).trim()
      if (newValue) {
        config.value = newValue
      }
    } else if (action === '3') {
      // Delete auth config
      if (authConfigs.length === 0) {
        console.log('No auth configurations to delete.')
        continue
      }
      const index = parseInt(await askQuestion(`Enter auth config number to delete (1-${authConfigs.length}): `))
      if (isNaN(index) || index < 1 || index > authConfigs.length) {
        console.log('Invalid selection.')
        continue
      }

      const confirm = (await askQuestion(`Delete "${authConfigs[index - 1].header}"? (y/n): `)).toLowerCase().trim()
      if (confirm === 'y') {
        authConfigs.splice(index - 1, 1)
        console.log('Deleted auth configuration.')
      }
    } else if (action === '4') {
      break
    } else {
      console.log('Invalid choice.')
    }
  }

  return authConfigs
}

/**
 * Validates authConfigs array structure
 */
function validateAuthConfigs(authConfigs?: AuthConfig[]): { isValid: boolean; error?: string } {
  if (!authConfigs) {
    return { isValid: true } // No auth configs is valid
  }

  if (!Array.isArray(authConfigs)) {
    return { isValid: false, error: 'authConfigs must be an array' }
  }

  // Check for duplicate header names (case-insensitive)
  const headerNames = authConfigs.map(config => config.header.toLowerCase())
  const uniqueHeaders = new Set(headerNames)
  if (headerNames.length !== uniqueHeaders.size) {
    return { isValid: false, error: 'Duplicate header names found in authConfigs (header names must be unique)' }
  }

  // Validate each auth config
  for (const [index, authConfig] of authConfigs.entries()) {
    if (!authConfig.header || authConfig.header.trim() === '') {
      return { isValid: false, error: `AuthConfig[${index}].header is required but empty` }
    }

    if (!/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(authConfig.header)) {
      return { isValid: false, error: `AuthConfig[${index}].header "${authConfig.header}" contains invalid characters` }
    }

    if (!authConfig.value || authConfig.value.trim() === '') {
      return { isValid: false, error: `AuthConfig[${index}].value for header "${authConfig.header}" is required but empty` }
    }

    // Basic header value validation (no control characters except tab and space)
    if (/[\x00-\x08\x0A-\x1F\x7F]/u.test(authConfig.value)) {
      return { isValid: false, error: `AuthConfig[${index}].value for header "${authConfig.header}" contains invalid control characters` }
    }
  }

  return { isValid: true }
}

/**
 * Returns config as-is (no cleanup needed since legacy auth fields are removed)
 */
function cleanupConfigForSaving(config: ServerConfig): ServerConfig {
  return { ...config }
}

// Export functions for testing
export { runWrangler, loadAllConfigs, saveSingleConfig, deleteSingleConfig, saveSecret, askQuestion, validateAuthConfigs, cleanupConfigForSaving }

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

  const needsAuthInput = (await askQuestion('Does it need authentication? (y/n): ')).toLowerCase().trim()
  const needsAuth = needsAuthInput === 'y'
  let authConfigs: AuthConfig[] | undefined

  if (needsAuth) {
    // Multi-auth configuration (only supported format)
    console.log('\n=== Authentication Headers ===')
    console.log('Configure authentication headers. Access is granted if ANY header matches.')
    authConfigs = await collectAuthConfigs()
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
  if (authConfigs) newConfig.authConfigs = authConfigs
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

  // Display current auth configuration
  console.log(`\nCurrent authentication: ${formatAuthConfigs(config)}`)

  const changeAuthInput = (await askQuestion('Change authentication? (y/n): ')).toLowerCase().trim()
  let authConfigs = config.authConfigs

  if (changeAuthInput === 'y') {
    const authMode = (await askQuestion('Choose auth mode:\n1. Multiple auth headers\n2. Remove all authentication\nEnter choice (1 or 2): ')).trim()

    if (authMode === '1') {
      // Multi-auth configuration
      console.log('\n=== Authentication Headers ===')
      console.log('Configure authentication headers. Access is granted if ANY header matches.')
      authConfigs = await editAuthConfigs(authConfigs)
    } else if (authMode === '2') {
      // Remove all authentication
      authConfigs = undefined
      console.log('All authentication removed.')
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
  if (authConfigs) updatedConfig.authConfigs = authConfigs
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
  if (Object.keys(currentConfig).length === 0) {
    console.log('No configurations found.')
  } else {
    for (const [id, config] of Object.entries(currentConfig)) {
      console.log(`\n${id}:`)
      console.log(`  URL: ${config.url}`)
      console.log(`  Auth: ${formatAuthConfigs(config)}`)
      if (config.headers && Object.keys(config.headers).length > 0) {
        console.log(`  Headers: ${JSON.stringify(config.headers, null, 2).replace(/\n/g, '\n  ')}`)
      }
    }
  }
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
    if (Object.keys(currentConfig).length === 0) {
      console.log('No configurations found.')
    } else {
      for (const [id, config] of Object.entries(currentConfig)) {
        console.log(`\n${id}:`)
        console.log(`  URL: ${config.url}`)
        console.log(`  Auth: ${formatAuthConfigs(config)}`)
        if (config.headers && Object.keys(config.headers).length > 0) {
          console.log(`  Headers: ${JSON.stringify(config.headers, null, 2).replace(/\n/g, '\n  ')}`)
        }
      }
    }
    console.log('\n')
    action = (await askQuestion('Another action? (a/m/d/q): ')).toLowerCase().trim()
  }

  rl.close()
}

main().catch(console.error)
