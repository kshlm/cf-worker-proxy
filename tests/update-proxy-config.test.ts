import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import * as crypto from 'crypto'
import { createInterface } from 'readline'

// Mock the modules
vi.mock('child_process')
vi.mock('fs')
vi.mock('crypto')
vi.mock('readline')
vi.mock('../src/types', () => ({
  ServerConfig: {} as any
}))

const mockExecSync = vi.mocked(execSync)
const mockReadFileSync = vi.mocked(readFileSync)
const mockCrypto = vi.mocked(crypto)
const mockCreateInterface = vi.mocked(createInterface)

describe('update-proxy-config', () => {
  let mockRl: any
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()
    
    // Mock readline interface
    mockRl = {
      question: vi.fn(),
      close: vi.fn()
    }
    mockCreateInterface.mockReturnValue(mockRl)
    
    // Mock wrangler.toml content
    mockReadFileSync.mockReturnValue(`
name = "worker-proxy"
[[kv_namespaces]]
binding = "PROXY_SERVERS"
id = "test-kv-namespace-id"
preview_id = "test-preview-id"
`)

    // Mock crypto.randomBytes
    const mockRandomBytes = {
      toString: vi.fn().mockReturnValue('abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890')
    }
    mockCrypto.randomBytes.mockReturnValue(mockRandomBytes as any)

    // Store original env
    originalEnv = process.env
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('runWrangler', () => {
    it('should return stdout on successful command', async () => {
      const { runWrangler } = await import('../scripts/update-proxy-config')
      
      mockExecSync.mockReturnValue('success output')
      
      const result = runWrangler('wrangler kv list')
      
      expect(result).toBe('success output')
      expect(mockExecSync).toHaveBeenCalledWith('wrangler kv list', {
        stdio: 'pipe',
        encoding: 'utf-8'
      })
    })

    it('should return stdout from error when command fails', async () => {
      const { runWrangler } = await import('../scripts/update-proxy-config')
      
      const error = new Error('Command failed') as any
      error.stdout = 'error output'
      mockExecSync.mockImplementation(() => {
        throw error
      })
      
      const result = runWrangler('wrangler kv list')
      
      expect(result).toBe('error output')
    })

    it('should return empty string when command fails with no stdout', async () => {
      const { runWrangler } = await import('../scripts/update-proxy-config')
      
      mockExecSync.mockImplementation(() => {
        throw new Error('Command failed')
      })
      
      const result = runWrangler('wrangler kv list')
      
      expect(result).toBe('')
    })
  })

  describe('loadAllConfigs', () => {
    it('should load configs from KV successfully', async () => {
      const { loadAllConfigs } = await import('../scripts/update-proxy-config')
      
      // Mock wrangler commands
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('kv key list')) {
          return JSON.stringify([
            { name: 'server1' },
            { name: 'server2' }
          ])
        }
        if (cmd.includes('kv key get "server1"')) {
          return JSON.stringify({ url: 'https://example1.com' })
        }
        if (cmd.includes('kv key get "server2"')) {
          return JSON.stringify({ url: 'https://example2.com', auth: 'Bearer token' })
        }
        return ''
      })
      
      const result = loadAllConfigs()
      
      expect(result).toEqual({
        server1: { url: 'https://example1.com' },
        server2: {
          url: 'https://example2.com',
          auth: 'Bearer token',
          authConfigs: [
            {
              header: 'Authorization',
              value: 'Bearer token'
            }
          ]
        }
      })
    })

    it('should handle empty KV namespace', async () => {
      const { loadAllConfigs } = await import('../scripts/update-proxy-config')
      
      mockExecSync.mockReturnValue(JSON.stringify({ result: [] }))
      mockExecSync.mockReturnValue(JSON.stringify([]))
      
      const result = loadAllConfigs()
      
      expect(result).toEqual({})
    })

    it('should handle malformed JSON gracefully', async () => {
      const { loadAllConfigs } = await import('../scripts/update-proxy-config')
      
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('kv key list')) {
          return JSON.stringify([{ name: 'server1' }])
        }
        if (cmd.includes('kv key get "server1"')) {
          return 'invalid json'
        }
        return ''
      })
      
      const result = loadAllConfigs()
      
      expect(result).toEqual({})
    })

    it('should handle list command failure', async () => {
      const { loadAllConfigs } = await import('../scripts/update-proxy-config')
      
      mockExecSync.mockImplementation(() => {
        throw new Error('List failed')
      })
      
      const result = loadAllConfigs()
      
      expect(result).toEqual({})
    })
  })

  describe('saveSingleConfig', () => {
    it('should save config successfully', async () => {
      const { saveSingleConfig } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      
      mockExecSync.mockReturnValue('success')
      
      saveSingleConfig('test-server', { url: 'https://example.com' })
      
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('wrangler kv key put "test-server"'),
        expect.any(Object)
      )
      expect(consoleSpy).toHaveBeenCalledWith('Saved config for test-server to KV.')
      
      consoleSpy.mockRestore()
    })

    it('should handle save failure', async () => {
      const { saveSingleConfig } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      mockExecSync.mockReturnValue('error: failed to save')
      
      saveSingleConfig('test-server', { url: 'https://example.com' })
      
      expect(consoleSpy).toHaveBeenCalledWith('Save failed for test-server:', 'error: failed to save')
      
      consoleSpy.mockRestore()
    })
  })

  describe('deleteSingleConfig', () => {
    it('should delete config successfully', async () => {
      const { deleteSingleConfig } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      
      mockExecSync.mockReturnValue('success')
      
      deleteSingleConfig('test-server')
      
      expect(mockExecSync).toHaveBeenCalledWith(
        'wrangler kv key delete "test-server" --binding=PROXY_SERVERS --remote',
        { stdio: 'pipe', encoding: 'utf-8' }
      )
      expect(consoleSpy).toHaveBeenCalledWith('Deleted config for test-server from KV.')
      
      consoleSpy.mockRestore()
    })

    it('should handle delete failure', async () => {
      const { deleteSingleConfig } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      mockExecSync.mockReturnValue('error: failed to delete')
      
      deleteSingleConfig('test-server')
      
      expect(consoleSpy).toHaveBeenCalledWith('Delete failed for test-server:', 'error: failed to delete')
      
      consoleSpy.mockRestore()
    })
  })

  describe('saveSecret', () => {
    it('should save secret successfully', async () => {
      const { saveSecret } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      
      mockExecSync.mockReturnValue('success')
      
      const result = saveSecret('TEST_SECRET', 'secret-value')
      
      expect(result).toBe(true)
      expect(mockExecSync).toHaveBeenCalledWith(
        'wrangler secret put "TEST_SECRET"',
        expect.objectContaining({
          input: 'secret-value\n'
        })
      )
      expect(consoleSpy).toHaveBeenCalledWith('Saved secret TEST_SECRET to Cloudflare.')
      
      consoleSpy.mockRestore()
    })

    it('should handle secret save failure', async () => {
      const { saveSecret } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      mockExecSync.mockImplementation(() => {
        throw new Error('Secret save failed')
      })
      
      const result = saveSecret('TEST_SECRET', 'secret-value')
      
      expect(result).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith('Failed to save secret TEST_SECRET:', expect.any(Error))
      
      consoleSpy.mockRestore()
    })
  })

  describe('integration scenarios', () => {
    it('should handle wrangler.toml without KV namespace ID', async () => {
      mockReadFileSync.mockReturnValue(`
name = "worker-proxy"
[[kv_namespaces]]
binding = "PROXY_SERVERS"
`)
      
      const { loadAllConfigs } = await import('../scripts/update-proxy-config')
      
      // Should use default namespace ID
      expect(() => loadAllConfigs()).not.toThrow()
    })

    it('should handle special characters in config JSON', async () => {
      const { saveSingleConfig } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      
      mockExecSync.mockReturnValue('success')
      
      const configWithSpecialChars = {
        url: 'https://example.com',
        headers: {
          'X-Auth': 'Bearer "token-with-quotes"',
          'X-Data': 'value with spaces and $pecial'
        }
      }
      
      saveSingleConfig('test-server', configWithSpecialChars)
      
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--remote'),
        expect.any(Object)
      )
      
      consoleSpy.mockRestore()
    })
  })
})