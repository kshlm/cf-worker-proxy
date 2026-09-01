import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import * as crypto from 'crypto'
import { createInterface } from 'readline'

// Mock the modules
vi.mock('child_process')
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync.bind(actual)) }
})
vi.mock('crypto')
vi.mock('readline')
vi.mock('../src/types', () => ({
  ServerConfig: {} as any,
}))

const mockExecFileSync = vi.mocked(execFileSync)

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
      close: vi.fn(),
    }
    mockCreateInterface.mockReturnValue(mockRl)

    // Mock crypto.randomBytes
    const mockRandomBytes = {
      toString: vi
        .fn()
        .mockReturnValue('abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'),
    }
    mockCrypto.randomBytes.mockReturnValue(mockRandomBytes as any)

    // Store original env
    originalEnv = process.env
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('runWrangler (delegated to scripts/wrangler)', () => {
    it('delegates argv-array execution to the shared helper', async () => {
      const helper = await import('../scripts/wrangler')
      expect(typeof helper.runWrangler).toBe('function')
      expect(typeof helper.isValidRouteId).toBe('function')
      expect(helper.isValidRouteId('global-auth-configs')).toBe(false)
    })
  })

  describe('loadAllConfigs', () => {
    it('should load configs from KV successfully, skipping the reserved key', async () => {
      const { loadAllConfigs } = await import('../scripts/update-proxy-config')

      mockExecFileSync.mockImplementation(((_file: string, args: string[]) => {
        if (args.includes('list')) {
          return JSON.stringify([
            { name: 'server1' },
            { name: 'server2' },
            { name: 'global-auth-configs' },
          ]) as unknown as string
        }
        if (args.includes('get') && args.includes('server1')) {
          return JSON.stringify({ url: 'https://example1.com' }) as unknown as string
        }
        if (args.includes('get') && args.includes('server2')) {
          return JSON.stringify({
            url: 'https://example2.com',
            authConfigs: [{ header: 'Authorization', value: 'Bearer token' }],
          }) as unknown as string
        }
        return '' as unknown
      }) as typeof execFileSync)

      const result = loadAllConfigs()

      expect(result).toEqual({
        server1: { url: 'https://example1.com' },
        server2: {
          url: 'https://example2.com',
          authConfigs: [{ header: 'Authorization', value: 'Bearer token' }],
        },
      })
    })

    it('should handle empty KV namespace', async () => {
      const { loadAllConfigs } = await import('../scripts/update-proxy-config')
      mockExecFileSync.mockReturnValue(JSON.stringify([]) as unknown as string)
      const result = loadAllConfigs()
      expect(result).toEqual({})
    })

    it('should handle malformed per-key JSON gracefully', async () => {
      const { loadAllConfigs } = await import('../scripts/update-proxy-config')
      mockExecFileSync.mockImplementation(((_file: string, args: string[]) => {
        if (args.includes('list')) return JSON.stringify([{ name: 'server1' }]) as unknown as string
        if (args.includes('get')) return 'invalid json' as unknown
        return '' as unknown
      }) as typeof execFileSync)
      const result = loadAllConfigs()
      expect(result).toEqual({})
    })

    it('should reject malformed list output instead of treating it as empty', async () => {
      const { loadAllConfigs } = await import('../scripts/update-proxy-config')
      mockExecFileSync.mockReturnValue('{"not":"an array"}' as unknown as string)
      expect(() => loadAllConfigs()).toThrow(/malformed/i)
    })
  })

  describe('saveSingleConfig', () => {
    it('should save valid config with argv-array wrangler call', async () => {
      const { saveSingleConfig } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      mockExecFileSync.mockReturnValue('success' as unknown as string)

      saveSingleConfig('test-server', { url: 'https://example.com' })

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'wrangler',
        expect.arrayContaining(['kv', 'key', 'put', 'test-server', '--path']),
        expect.objectContaining({ shell: false }),
      )
      expect(consoleSpy).toHaveBeenCalledWith('Saved config for test-server to KV.')

      consoleSpy.mockRestore()
    })

    it('should throw on config with unsupported legacy auth fields', async () => {
      const { saveSingleConfig } = await import('../scripts/update-proxy-config')
      expect(() =>
        saveSingleConfig('test-server', {
          url: 'https://example.com',
          auth: 'x',
        } as unknown as Parameters<typeof saveSingleConfig>[1]),
      ).toThrow(/Legacy auth fields/)
    })

    it('should throw on invalid route id', async () => {
      const { saveSingleConfig } = await import('../scripts/update-proxy-config')
      expect(() => saveSingleConfig('bad id', { url: 'https://example.com' })).toThrow(
        /Invalid route id/,
      )
    })

    it('should propagate wrangler failures', async () => {
      const { saveSingleConfig } = await import('../scripts/update-proxy-config')
      mockExecFileSync.mockImplementation(() => {
        throw new Error('put failed')
      })
      expect(() => saveSingleConfig('test-server', { url: 'https://example.com' })).toThrow(
        'put failed',
      )
    })
  })

  describe('deleteSingleConfig', () => {
    it('should delete config with argv-array call', async () => {
      const { deleteSingleConfig } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      mockExecFileSync.mockReturnValue('success' as unknown as string)

      deleteSingleConfig('test-server')

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'wrangler',
        expect.arrayContaining(['kv', 'key', 'delete', 'test-server']),
        expect.objectContaining({ shell: false }),
      )
      expect(consoleSpy).toHaveBeenCalledWith('Deleted config for test-server from KV.')

      consoleSpy.mockRestore()
    })

    it('should propagate delete failures', async () => {
      const { deleteSingleConfig } = await import('../scripts/update-proxy-config')
      mockExecFileSync.mockImplementation(() => {
        throw new Error('delete failed')
      })
      expect(() => deleteSingleConfig('test-server')).toThrow('delete failed')
    })
  })

  describe('saveSecret', () => {
    it('should save secret successfully without logging the value', async () => {
      const { saveSecret } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      mockExecFileSync.mockReturnValue('success' as unknown as string)

      const result = saveSecret('TEST_SECRET', 'secret-value')

      expect(result).toBe(true)
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'wrangler',
        expect.arrayContaining(['secret', 'put', 'TEST_SECRET']),
        expect.objectContaining({ input: 'secret-value\n', shell: false }),
      )
      const logged = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n')
      expect(logged).not.toContain('secret-value')
      consoleSpy.mockRestore()
    })

    it('should return false on failure', async () => {
      const { saveSecret } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockExecFileSync.mockImplementation(() => {
        throw new Error('Secret save failed')
      })

      const result = saveSecret('TEST_SECRET', 'secret-value')

      expect(result).toBe(false)
      consoleSpy.mockRestore()
    })
  })

  describe('integration scenarios', () => {
    it('should handle special characters in config JSON', async () => {
      const { saveSingleConfig } = await import('../scripts/update-proxy-config')
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      mockExecFileSync.mockReturnValue('success' as unknown as string)

      const configWithSpecialChars = {
        url: 'https://example.com',
        headers: {
          'X-Auth': 'Bearer "token-with-quotes"',
          'X-Data': 'value with spaces and $pecial',
        },
      }

      saveSingleConfig('test-server', configWithSpecialChars)

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'wrangler',
        expect.anything(),
        expect.objectContaining({ shell: false }),
      )

      consoleSpy.mockRestore()
    })
  })
})
