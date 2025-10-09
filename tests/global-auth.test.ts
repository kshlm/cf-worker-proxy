import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadGlobalAuthFromEnv, loadGlobalAuthFromKV, loadGlobalAuthConfiguration, checkGlobalAuth } from '../src/utils/global-auth'
import { Env, AuthConfig } from '../src/types'

describe('Global Authentication', () => {
  let mockEnv: Env

  beforeEach(() => {
    mockEnv = {
      PROXY_SERVERS: {
        get: vi.fn()
      } as any
    }
    vi.clearAllMocks()
  })

  describe('loadGlobalAuthFromEnv', () => {
    it('should return empty result when no global auth configured', async () => {
      const result = await loadGlobalAuthFromEnv(mockEnv)
      expect(result.configs).toEqual([])
      expect(result.hasGlobalAuth).toBe(false)
      expect(result.error).toBeUndefined()
    })

    it('should load global auth from environment variable', async () => {
      const globalAuthConfig = JSON.stringify([
        { header: 'Authorization', value: 'Bearer global-token' },
        { header: 'X-API-Key', value: 'global-secret' }
      ])
      mockEnv.GLOBAL_AUTH_CONFIGS = globalAuthConfig

      const result = await loadGlobalAuthFromEnv(mockEnv)
      expect(result.configs).toEqual([
        { header: 'Authorization', value: 'Bearer global-token' },
        { header: 'X-API-Key', value: 'global-secret' }
      ])
      expect(result.hasGlobalAuth).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should return error for invalid JSON', async () => {
      mockEnv.GLOBAL_AUTH_CONFIGS = 'invalid-json'

      const result = await loadGlobalAuthFromEnv(mockEnv)
      expect(result.configs).toEqual([])
      expect(result.hasGlobalAuth).toBe(false)
      expect(result.error).toContain('Failed to parse global auth configuration')
    })

    it('should return error for invalid auth config structure', async () => {
      const invalidConfig = JSON.stringify([
        { header: '', value: 'token' }, // invalid empty header
        { header: 'X-API-Key', value: '' } // invalid empty value
      ])
      mockEnv.GLOBAL_AUTH_CONFIGS = invalidConfig

      const result = await loadGlobalAuthFromEnv(mockEnv)
      expect(result.configs).toEqual([])
      expect(result.hasGlobalAuth).toBe(false)
      expect(result.error).toContain('Global auth configuration invalid')
    })
  })

  describe('loadGlobalAuthFromKV', () => {
    it('should return empty result when no global auth in KV', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(null)

      const result = await loadGlobalAuthFromKV(mockEnv)
      expect(result.configs).toEqual([])
      expect(result.hasGlobalAuth).toBe(false)
      expect(result.error).toBeUndefined()
    })

    it('should load global auth from KV storage', async () => {
      const globalAuthConfig = JSON.stringify([
        { header: 'Authorization', value: 'Bearer kv-token' }
      ])
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(globalAuthConfig)

      const result = await loadGlobalAuthFromKV(mockEnv)
      expect(result.configs).toEqual([
        { header: 'Authorization', value: 'Bearer kv-token' }
      ])
      expect(result.hasGlobalAuth).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should return error for KV retrieval failure', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockRejectedValue(new Error('KV error'))

      const result = await loadGlobalAuthFromKV(mockEnv)
      expect(result.configs).toEqual([])
      expect(result.hasGlobalAuth).toBe(false)
      expect(result.error).toContain('Failed to load global auth from KV')
    })
  })

  describe('loadGlobalAuthConfiguration', () => {
    it('should prefer environment variable over KV', async () => {
      const envConfig = JSON.stringify([{ header: 'Authorization', value: 'Bearer env-token' }])
      const kvConfig = JSON.stringify([{ header: 'Authorization', value: 'Bearer kv-token' }])

      mockEnv.GLOBAL_AUTH_CONFIGS = envConfig
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(kvConfig)

      const result = await loadGlobalAuthConfiguration(mockEnv)
      expect(result.configs).toEqual([
        { header: 'Authorization', value: 'Bearer env-token' }
      ])
      expect(result.hasGlobalAuth).toBe(true)
    })

    it('should fall back to KV when env variable not set', async () => {
      const kvConfig = JSON.stringify([{ header: 'X-API-Key', value: 'kv-secret' }])

      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(kvConfig)

      const result = await loadGlobalAuthConfiguration(mockEnv)
      expect(result.configs).toEqual([
        { header: 'X-API-Key', value: 'kv-secret' }
      ])
      expect(result.hasGlobalAuth).toBe(true)
    })

    it('should return empty when neither env nor KV has config', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(null)

      const result = await loadGlobalAuthConfiguration(mockEnv)
      expect(result.configs).toEqual([])
      expect(result.hasGlobalAuth).toBe(false)
    })

    it('should interpolate secrets in global auth config', async () => {
      const configWithSecrets = JSON.stringify([
        { header: 'Authorization', value: 'Bearer ${GLOBAL_TOKEN}' },
        { header: 'X-API-Key', value: '${GLOBAL_API_KEY}' }
      ])

      mockEnv.GLOBAL_AUTH_CONFIGS = configWithSecrets
      mockEnv.GLOBAL_TOKEN = 'interpolated-token'
      mockEnv.GLOBAL_API_KEY = 'interpolated-key'

      const result = await loadGlobalAuthConfiguration(mockEnv)
      expect(result.configs).toEqual([
        { header: 'Authorization', value: 'Bearer interpolated-token' },
        { header: 'X-API-Key', value: 'interpolated-key' }
      ])
      expect(result.hasGlobalAuth).toBe(true)
    })

    it('should return error for missing secrets in global auth', async () => {
      const configWithMissingSecret = JSON.stringify([
        { header: 'Authorization', value: 'Bearer ${MISSING_SECRET}' }
      ])

      mockEnv.GLOBAL_AUTH_CONFIGS = configWithMissingSecret

      const result = await loadGlobalAuthConfiguration(mockEnv)
      expect(result.configs).toEqual([])
      expect(result.hasGlobalAuth).toBe(false)
      expect(result.error).toContain('Global auth secret interpolation failed')
    })
  })

  describe('checkGlobalAuth', () => {
    it('should allow access when no global auth configured', () => {
      const request = new Request('https://proxy.example.com/api/test')
      const globalAuthConfigs: AuthConfig[] = []

      const result = checkGlobalAuth(request, globalAuthConfigs)
      expect(result).toBe(true)
    })

    it('should allow access when request has valid global auth', () => {
      const request = new Request('https://proxy.example.com/api/test', {
        headers: { 'Authorization': 'Bearer global-token' }
      })
      const globalAuthConfigs: AuthConfig[] = [
        { header: 'Authorization', value: 'Bearer global-token' }
      ]

      const result = checkGlobalAuth(request, globalAuthConfigs)
      expect(result).toBe(true)
    })

    it('should deny access when request has invalid global auth', () => {
      const request = new Request('https://proxy.example.com/api/test', {
        headers: { 'Authorization': 'Bearer wrong-token' }
      })
      const globalAuthConfigs: AuthConfig[] = [
        { header: 'Authorization', value: 'Bearer global-token' }
      ]

      const result = checkGlobalAuth(request, globalAuthConfigs)
      expect(result).toBe(false)
    })

    it('should deny access when request missing global auth', () => {
      const request = new Request('https://proxy.example.com/api/test')
      const globalAuthConfigs: AuthConfig[] = [
        { header: 'Authorization', value: 'Bearer global-token' }
      ]

      const result = checkGlobalAuth(request, globalAuthConfigs)
      expect(result).toBe(false)
    })

    it('should allow access when any global auth config matches (any one match logic)', () => {
      const request = new Request('https://proxy.example.com/api/test', {
        headers: { 'X-API-Key': 'global-secret' }
      })
      const globalAuthConfigs: AuthConfig[] = [
        { header: 'Authorization', value: 'Bearer global-token' },
        { header: 'X-API-Key', value: 'global-secret' }
      ]

      const result = checkGlobalAuth(request, globalAuthConfigs)
      expect(result).toBe(true)
    })

    it('should be case-insensitive for header names', () => {
      const request = new Request('https://proxy.example.com/api/test', {
        headers: { 'authorization': 'Bearer global-token' }
      })
      const globalAuthConfigs: AuthConfig[] = [
        { header: 'Authorization', value: 'Bearer global-token' }
      ]

      const result = checkGlobalAuth(request, globalAuthConfigs)
      expect(result).toBe(true)
    })

    it('should deny access when no headers match', () => {
      const request = new Request('https://proxy.example.com/api/test', {
        headers: { 'X-Other': 'some-value' }
      })
      const globalAuthConfigs: AuthConfig[] = [
        { header: 'Authorization', value: 'Bearer global-token' },
        { header: 'X-API-Key', value: 'global-secret' }
      ]

      const result = checkGlobalAuth(request, globalAuthConfigs)
      expect(result).toBe(false)
    })
  })

  describe('Integration with worker', () => {
    // These tests verify that global auth integrates correctly with the main worker flow
    it('should handle global auth success in integration test', async () => {
      const globalAuthConfig = JSON.stringify([
        { header: 'Authorization', value: 'Bearer global-token' }
      ])
      const serverConfig = {
        url: 'https://api.example.com',
        auth: 'Bearer server-token' // This should be ignored when global auth succeeds
      }

      mockEnv.GLOBAL_AUTH_CONFIGS = globalAuthConfig
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(serverConfig)

      const worker = await import('../src/index')

      const mockResponse = new Response('Success', { status: 200 })
      global.fetch = vi.fn().mockResolvedValue(mockResponse)

      const request = new Request('https://proxy.example.com/api/test', {
        headers: { 'Authorization': 'Bearer global-token' }
      })

      const response = await worker.default.fetch(request, mockEnv)
      expect(response.status).toBe(200)

      // Verify that the request was forwarded
      expect(global.fetch).toHaveBeenCalled()
      const forwardedRequest = (global.fetch as any).mock.calls[0][0] as Request
      expect(forwardedRequest.headers.get('Authorization')).toBeNull() // Should be removed
    })

    it('should fall back to per-server auth when global auth fails', async () => {
      const globalAuthConfig = JSON.stringify([
        { header: 'Authorization', value: 'Bearer global-token' }
      ])
      const serverConfig = {
        url: 'https://api.example.com',
        auth: 'Bearer server-token'
      }

      mockEnv.GLOBAL_AUTH_CONFIGS = globalAuthConfig
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(serverConfig)

      const worker = await import('../src/index')

      const mockResponse = new Response('Success', { status: 200 })
      global.fetch = vi.fn().mockResolvedValue(mockResponse)

      const request = new Request('https://proxy.example.com/api/test', {
        headers: { 'Authorization': 'Bearer server-token' }
      })

      const response = await worker.default.fetch(request, mockEnv)
      expect(response.status).toBe(200)
    })

    it('should deny access when both global and per-server auth fail', async () => {
      const globalAuthConfig = JSON.stringify([
        { header: 'Authorization', value: 'Bearer global-token' }
      ])
      const serverConfig = {
        url: 'https://api.example.com',
        auth: 'Bearer server-token'
      }

      mockEnv.GLOBAL_AUTH_CONFIGS = globalAuthConfig
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(serverConfig)

      const worker = await import('../src/index')

      const request = new Request('https://proxy.example.com/api/test', {
        headers: { 'Authorization': 'Bearer wrong-token' }
      })

      const response = await worker.default.fetch(request, mockEnv)
      expect(response.status).toBe(401)
    })

    it('should require global auth even when server has no per-server auth', async () => {
      // Test the two-tier auth logic directly instead of through worker integration
      const { checkTwoTierAuth } = await import('../src/request-processor')

      const globalAuthConfigs = [
        { header: 'Authorization', value: 'Bearer global-token' }
      ]
      const perServerAuthConfigs = [] // No auth configured

      const request = new Request('https://proxy.example.com/api/test')
      // No auth headers provided

      const result = checkTwoTierAuth(request, globalAuthConfigs, perServerAuthConfigs)
      expect(result.authenticated).toBe(false)
      expect(result.usedGlobalAuth).toBe(false)
    })

    it('should work without global auth (backward compatibility)', async () => {
      // Test the two-tier auth logic directly for backward compatibility
      const { checkTwoTierAuth } = await import('../src/request-processor')

      const globalAuthConfigs = [] // No global auth configured
      const perServerAuthConfigs = [
        { header: 'Authorization', value: 'Bearer server-token' }
      ]

      const request = new Request('https://proxy.example.com/api/test', {
        headers: { 'Authorization': 'Bearer server-token' }
      })

      const result = checkTwoTierAuth(request, globalAuthConfigs, perServerAuthConfigs)
      expect(result.authenticated).toBe(true)
      expect(result.usedGlobalAuth).toBe(false)
    })
  })
})