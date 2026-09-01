import { createInterface } from 'readline'
import * as crypto from 'crypto'
import * as fs from 'fs'
import { ServerConfig, AuthConfig } from '../src/types'
import { validateProcessedConfig } from '../src/config-validator'
import {
  runWrangler as runWranglerArgs,
  writeTempFile,
  isValidRouteId,
  parseKeyList,
  isValidHeaderName,
  GLOBAL_AUTH_KV_KEY,
} from './wrangler'

let currentConfig: Record<string, ServerConfig> = {}

function loadAllConfigs(): Record<string, ServerConfig> {
  const config: Record<string, ServerConfig> = {}
  const listOutput = runWranglerArgs(['kv', 'key', 'list', '--binding=PROXY_SERVERS'])
  for (const kvKey of parseKeyList(listOutput)) {
    // Reserved key is global auth config, not a route
    if (kvKey.name === GLOBAL_AUTH_KV_KEY) continue
    const data = runWranglerArgs(['kv', 'key', 'get', kvKey.name, '--binding=PROXY_SERVERS'])
    if (data) {
      try {
        config[kvKey.name] = JSON.parse(data) as ServerConfig
      } catch (e) {
        console.log(`Failed to parse config for ${kvKey.name}:`, e)
      }
    }
  }
  return config
}

function saveSingleConfig(id: string, config: ServerConfig): void {
  if (!isValidRouteId(id)) {
    throw new Error(`Invalid route id "${id}"`)
  }
  // Full runtime validation: script rejects what the worker would reject
  const validation = validateProcessedConfig(config)
  if (!validation.isValid) {
    throw new Error(`Validation failed for ${id}: ${validation.error?.message}`)
  }

  const configJson = JSON.stringify(config, null, 2)
  const tempFile = writeTempFile('proxy-config-', configJson)
  try {
    runWranglerArgs(['kv', 'key', 'put', id, '--binding=PROXY_SERVERS', '--path', tempFile])
    console.log(`Saved config for ${id} to KV.`)
  } finally {
    try {
      fs.unlinkSync(tempFile)
    } catch (unlinkErr) {
      console.warn(`Failed to delete temp file ${tempFile}:`, unlinkErr)
    }
  }
}

function deleteSingleConfig(id: string): void {
  if (!isValidRouteId(id)) {
    throw new Error(`Invalid route id "${id}"`)
  }
  runWranglerArgs(['kv', 'key', 'delete', id, '--binding=PROXY_SERVERS'])
  console.log(`Deleted config for ${id} from KV.`)
}

function saveSecret(secretName: string, value: string): boolean {
  try {
    runWranglerArgs(['secret', 'put', secretName], { input: `${value}\n` })
    console.log(`Saved secret ${secretName} to Cloudflare.`)
    return true
  } catch (e) {
    console.error(`Failed to save secret ${secretName}:`, e instanceof Error ? e.message : e)
    return false
  }
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
})

async function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve))
}

/**
 * Formats auth configurations for display
 */
function formatAuthConfigs(config: ServerConfig): string {
  if (!config.authConfigs || config.authConfigs.length === 0) {
    return 'No authentication'
  }

  return config.authConfigs
    .map((auth) => {
      const value = auth.value.includes('${')
        ? auth.value.replace(/\$\{[^}]+\}/g, '[$SECRET]')
        : '[sensitive value]'
      return `${auth.header}: ${value}`
    })
    .join(', ')
}

/**
 * Prompts user to add multiple auth configurations
 */
async function collectAuthConfigs(): Promise<AuthConfig[]> {
  const authConfigs: AuthConfig[] = []

  while (true) {
    console.log(`\n--- Auth Configuration ${authConfigs.length + 1} ---`)

    const headerName = (
      await askQuestion('Enter header name (e.g., Authorization, X-API-Key): ')
    ).trim()
    if (!headerName) {
      if (authConfigs.length === 0) {
        console.log('At least one auth configuration is required for authentication.')
        continue
      }
      break
    }

    // Validate header name format
    if (!isValidHeaderName(headerName)) {
      console.log('Invalid header name format. Please use valid HTTP header characters.')
      continue
    }

    // Check for duplicate header names
    if (authConfigs.some((config) => config.header.toLowerCase() === headerName.toLowerCase())) {
      console.log(`Header "${headerName}" already configured. Please use a different header name.`)
      continue
    }

    const authChoice = (
      await askQuestion(
        'Choose auth type:\n1. Manual entry (use ${SECRET_NAME} placeholders)\n2. Auto-generate token and save as secret\n3. Auto-generate with custom pattern (use <TOKEN> placeholder)\nEnter choice (1, 2, or 3): ',
      )
    ).trim()

    let authValue: string
    if (authChoice === '2') {
      const token = crypto.randomBytes(32).toString('hex')
      const secretName = `${headerName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`
      const confirm = (await askQuestion('Save this token as a secret? (y/n): '))
        .toLowerCase()
        .trim()
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
      const pattern = (
        await askQuestion(
          'Enter auth pattern with <TOKEN> placeholder (e.g., "Bearer <TOKEN>", "<TOKEN>", "X-API-Key: <TOKEN>"): ',
        )
      ).trim()
      if (!pattern || !pattern.includes('<TOKEN>')) {
        console.log('Pattern must include <TOKEN> placeholder. Using manual entry.')
        authValue = (await askQuestion(`Enter auth header value for "${headerName}": `)).trim()
      } else {
        const token = crypto.randomBytes(32).toString('hex')
        const secretName = `${headerName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`
        const confirm = (await askQuestion('Save this token as a secret? (y/n): '))
          .toLowerCase()
          .trim()
        if (confirm === 'y') {
          console.log(`Saving auth token as secret ${secretName}...`)
          if (saveSecret(secretName, token)) {
            authValue = pattern.replace('<TOKEN>', `\${${secretName}}`)
            console.log(
              `Auth value set to: ${authValue.replace(/\$\{[^}]+\}/g, '[$SECRET]')} (token saved securely).`,
            )
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

    const addMore = (await askQuestion('Add another auth configuration? (y/n): '))
      .toLowerCase()
      .trim()
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

    const action = (
      await askQuestion(
        '\nChoose action:\n1. Add auth header\n2. Edit auth header\n3. Delete auth header\n4. Done\nEnter choice (1-4): ',
      )
    ).trim()

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
      const index = parseInt(
        await askQuestion(`Enter auth config number to edit (1-${authConfigs.length}): `),
      )
      if (isNaN(index) || index < 1 || index > authConfigs.length) {
        console.log('Invalid selection.')
        continue
      }

      const config = authConfigs[index - 1]
      console.log(`\nEditing: ${config.header}`)

      const newHeader = (await askQuestion(`Header name (${config.header}): `)).trim()
      if (newHeader && newHeader !== config.header) {
        if (!isValidHeaderName(newHeader)) {
          console.log('Invalid header name format. Keeping original.')
        } else if (
          authConfigs.some(
            (c, i) => i !== index - 1 && c.header.toLowerCase() === newHeader.toLowerCase(),
          )
        ) {
          console.log(`Header "${newHeader}" already exists. Keeping original.`)
        } else {
          config.header = newHeader
        }
      }

      const newValue = (
        await askQuestion(
          `Auth value (current: ${config.value.includes('${') ? config.value.replace(/\$\{[^}]+\}/g, '[$SECRET]') : '[sensitive value]'}): `,
        )
      ).trim()
      if (newValue) {
        config.value = newValue
      }
    } else if (action === '3') {
      // Delete auth config
      if (authConfigs.length === 0) {
        console.log('No auth configurations to delete.')
        continue
      }
      const index = parseInt(
        await askQuestion(`Enter auth config number to delete (1-${authConfigs.length}): `),
      )
      if (isNaN(index) || index < 1 || index > authConfigs.length) {
        console.log('Invalid selection.')
        continue
      }

      const confirm = (await askQuestion(`Delete "${authConfigs[index - 1].header}"? (y/n): `))
        .toLowerCase()
        .trim()
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

// Export functions for testing
export {
  loadAllConfigs,
  saveSingleConfig,
  deleteSingleConfig,
  saveSecret,
  askQuestion,
  formatAuthConfigs,
}

async function bootstrap() {
  currentConfig = loadAllConfigs()
  console.log(`Loaded ${Object.keys(currentConfig).length} existing configurations.`)
  await main()
}

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

  const needsAuthInput = (await askQuestion('Does it need authentication? (y/n): '))
    .toLowerCase()
    .trim()
  const needsAuth = needsAuthInput === 'y'
  let authConfigs: AuthConfig[] | undefined

  if (needsAuth) {
    // Multi-auth configuration (only supported format)
    console.log('\n=== Authentication Headers ===')
    console.log('Configure authentication headers. Access is granted if ANY header matches.')
    authConfigs = await collectAuthConfigs()
  }

  const needsHeadersInput = (await askQuestion('Add downstream headers? (y/n): '))
    .toLowerCase()
    .trim()
  const needsHeaders = needsHeadersInput === 'y'
  let headers: Record<string, string> = {}

  if (needsHeaders) {
    console.log(
      'Remember: For sensitive values, use placeholders like "${SECRET_NAME}". Set secrets with "wrangler secret put SECRET_NAME"',
    )
    const headersStr = await askQuestion(
      'Enter headers as JSON object (e.g., {"X-Key": "value", "Authorization": "Bearer ${TOKEN}"}): ',
    )
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

  try {
    saveSingleConfig(id, newConfig)
  } catch (e) {
    console.error(`Failed to add ${id}:`, e instanceof Error ? e.message : e)
    return
  }
  currentConfig[id] = newConfig
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
    const authMode = (
      await askQuestion(
        'Choose auth mode:\n1. Multiple auth headers\n2. Remove all authentication\nEnter choice (1 or 2): ',
      )
    ).trim()

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
    console.log(
      'Remember: For sensitive values, use placeholders like "${SECRET_NAME}". Set secrets with "wrangler secret put SECRET_NAME"',
    )
    const headersStr = await askQuestion(
      `Enter new headers as JSON (current: ${currentHeadersStr}, empty to remove all): `,
    )
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

  try {
    saveSingleConfig(id, updatedConfig)
  } catch (e) {
    console.error(`Failed to modify ${id}:`, e instanceof Error ? e.message : e)
    return
  }
  currentConfig[id] = updatedConfig
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
    try {
      deleteSingleConfig(id)
    } catch (e) {
      console.error(`Failed to delete ${id}:`, e instanceof Error ? e.message : e)
      return
    }
    delete currentConfig[id]
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

  let action = (await askQuestion('What do you want to do? (a)dd, (m)odify, (d)elete, (q)uit: '))
    .toLowerCase()
    .trim()

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
          console.log(
            `  Headers: ${JSON.stringify(config.headers, null, 2).replace(/\n/g, '\n  ')}`,
          )
        }
      }
    }
    console.log('\n')
    action = (await askQuestion('Another action? (a/m/d/q): ')).toLowerCase().trim()
  }

  rl.close()
}

if (process.argv[1] && process.argv[1].endsWith('update-proxy-config.ts') && !process.env.VITEST) {
  bootstrap().catch((error: unknown) => {
    console.error('update-proxy-config failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
