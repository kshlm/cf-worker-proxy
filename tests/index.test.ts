import { describe, it, expect, vi, beforeEach } from 'vitest'
import worker from '../src/index'
import { Env } from '../src/types'

// Mock fetch for testing
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('worker', () => {
  let mockEnv: Env

  beforeEach(() => {
    mockEnv = {
      PROXY_SERVERS: {
        get: vi.fn()
      } as any
    }
    vi.clearAllMocks()
  })

  it('should return 404 for empty path', async () => {
    const request = new Request('https://proxy.example.com/')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('{"error":"Invalid route: No server configured for this path."}')
  })

  it('should return 404 for non-existent server', async () => {
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(null)

    const request = new Request('https://proxy.example.com/unknown/path')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('{"error":"Server not found: No configuration available for this route."}')
  })

  it('should return 401 for missing auth when required', async () => {
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
      url: 'https://api.example.com',
      auth: 'Bearer required-token'
    })

    const request = new Request('https://proxy.example.com/api/users')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('{"error":"Unauthorized: Invalid or missing credentials."}')
  })

  it('should proxy request successfully', async () => {
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
      url: 'https://api.example.com',
      headers: { 'X-Custom': 'value' }
    })

    const mockResponse = new Response('Success', { status: 200 })
    mockFetch.mockResolvedValue(mockResponse)

    const request = new Request('https://proxy.example.com/api/users/123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"test": "data"}'
    })

    const response = await worker.fetch(request, mockEnv)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Success')

    expect(mockFetch).toHaveBeenCalledWith(expect.any(Request))

    const calledRequest = mockFetch.mock.calls[0][0] as Request
    expect(calledRequest.url).toBe('https://api.example.com/users/123')
    expect(calledRequest.method).toBe('POST')
    expect(calledRequest.headers.get('Content-Type')).toBe('application/json')
    expect(calledRequest.headers.get('X-Custom')).toBe('value')
  })

  it('should return 500 for KV errors', async () => {
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockRejectedValue(new Error('KV error'))

    const request = new Request('https://proxy.example.com/api/test')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('{"error":"Failed to load global auth from KV: KV error"}')
  })

  it('should return 500 for invalid backend URL', async () => {
    const invalidConfig = {
      url: 'not-a-valid-url'
    }
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(invalidConfig)

    const request = new Request('https://proxy.example.com/api/test')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('{"error":"Configuration invalid: Backend URL is malformed or insecure."}')
  })

  it('should return 500 for non-HTTPS URLs', async () => {
    const httpConfig = {
      url: 'http://api.example.com'
    }
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(httpConfig)

    const request = new Request('https://proxy.example.com/api/test')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('{"error":"Configuration invalid: Backend URL is malformed or insecure."}')
  })

  it('should return 502 for backend fetch errors', async () => {
    const backendConfig = {
      url: 'https://api.example.com'
    }
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(backendConfig)
    mockFetch.mockRejectedValue(new Error('Network error'))

    const request = new Request('https://proxy.example.com/api/test')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(502)
    expect(await response.text()).toBe('{"error":"Backend unavailable: Target server is unreachable."}')
  })

  it('should work with custom auth header', async () => {
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
      url: 'https://api.example.com',
      auth: 'secret-api-key-123',
      authHeader: 'X-API-Key'
    })

    const mockResponse = new Response('Success', { status: 200 })
    mockFetch.mockResolvedValue(mockResponse)

    const request = new Request('https://proxy.example.com/api/users', {
      headers: { 'X-API-Key': 'secret-api-key-123' }
    })

    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(200)
  })

  it('should return 401 when custom auth header is missing', async () => {
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
      url: 'https://api.example.com',
      auth: 'secret-api-key-123',
      authHeader: 'X-API-Key'
    })

    const request = new Request('https://proxy.example.com/api/users')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('{"error":"Unauthorized: Invalid or missing credentials."}')
  })

  it('should return 401 when custom auth header does not match', async () => {
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
      url: 'https://api.example.com',
      auth: 'secret-api-key-123',
      authHeader: 'X-API-Key'
    })

    const request = new Request('https://proxy.example.com/api/users', {
      headers: { 'X-API-Key': 'wrong-key' }
    })
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('{"error":"Unauthorized: Invalid or missing credentials."}')
  })

  describe('header forwarding', () => {
    it('should forward all incoming headers except Authorization header', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        auth: 'Bearer token123'
      })

      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('https://proxy.example.com/api/users', {
        headers: {
          'Authorization': 'Bearer token123',
          'X-Custom-Incoming': 'incoming-value',
          'Content-Type': 'application/json',
          'User-Agent': 'test-agent'
        }
      })

      const response = await worker.fetch(request, mockEnv)
      expect(response.status).toBe(200)

      const calledRequest = mockFetch.mock.calls[0][0] as Request
      expect(calledRequest.headers.get('X-Custom-Incoming')).toBe('incoming-value')
      expect(calledRequest.headers.get('Content-Type')).toBe('application/json')
      expect(calledRequest.headers.get('User-Agent')).toBe('test-agent')
      expect(calledRequest.headers.get('Authorization')).toBeNull()
    })

    it('should forward all incoming headers except custom auth header', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        auth: 'secret-key',
        authHeader: 'X-API-Key'
      })

      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('https://proxy.example.com/api/users', {
        headers: {
          'X-API-Key': 'secret-key',
          'X-Custom-Incoming': 'incoming-value',
          'Authorization': 'Bearer should-pass-through',
          'Content-Type': 'application/json'
        }
      })

      const response = await worker.fetch(request, mockEnv)
      expect(response.status).toBe(200)

      const calledRequest = mockFetch.mock.calls[0][0] as Request
      expect(calledRequest.headers.get('X-Custom-Incoming')).toBe('incoming-value')
      expect(calledRequest.headers.get('Authorization')).toBe('Bearer should-pass-through')
      expect(calledRequest.headers.get('Content-Type')).toBe('application/json')
      expect(calledRequest.headers.get('X-API-Key')).toBeNull()
    })

    it('should add configured headers only when they dont exist in incoming request', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        headers: {
          'X-Config-Header': 'config-value',
          'X-Override-Test': 'config-value'
        }
      })

      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('https://proxy.example.com/api/users', {
        headers: {
          'X-Override-Test': 'incoming-value',
          'X-Incoming-Only': 'incoming-value'
        }
      })

      const response = await worker.fetch(request, mockEnv)
      expect(response.status).toBe(200)

      const calledRequest = mockFetch.mock.calls[0][0] as Request
      expect(calledRequest.headers.get('X-Config-Header')).toBe('config-value')
      expect(calledRequest.headers.get('X-Override-Test')).toBe('incoming-value')
      expect(calledRequest.headers.get('X-Incoming-Only')).toBe('incoming-value')
    })

  describe('secret interpolation', () => {
    const configWithSecrets = {
      url: 'https://api.example.com',
      auth: 'Bearer ${API_TOKEN}',
      headers: { 'X-Auth': '${API_TOKEN}', 'X-Static': 'static' }
    }

    it('should interpolate secrets for auth and allow request if matches', async () => {
      const envWithSecret = { ...mockEnv, API_TOKEN: 'fake-token' }
      vi.mocked(envWithSecret.PROXY_SERVERS.get).mockResolvedValue(configWithSecrets)

      const request = new Request('https://proxy.example.com/api/users', {
        headers: { Authorization: 'Bearer fake-token' }
      })

      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const response = await worker.fetch(request, envWithSecret as Env)
      expect(response.status).toBe(200)
    })

    it('should return 401 if auth header does not match interpolated secret', async () => {
      const envWithSecret = { ...mockEnv, API_TOKEN: 'correct-token' }
      vi.mocked(envWithSecret.PROXY_SERVERS.get).mockResolvedValue(configWithSecrets)

      const request = new Request('https://proxy.example.com/api/users', {
        headers: { Authorization: 'Bearer wrong-token' }
      })

      const response = await worker.fetch(request, envWithSecret as Env)
      expect(response.status).toBe(401)
      expect(await response.text()).toBe('{"error":"Unauthorized: Invalid or missing credentials."}')
    })

    it('should return 500 if required auth secret is missing', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(configWithSecrets)

      const request = new Request('https://proxy.example.com/api/users')

      const response = await worker.fetch(request, mockEnv as Env)
      expect(response.status).toBe(500)
      // Note: exact error message not exposed, but status is 500
    })

    it('should fallback to placeholder in headers if secret missing', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        auth: undefined,
        headers: { 'X-Auth': '${API_TOKEN}' }
      })

      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('https://proxy.example.com/api/users')

      const response = await worker.fetch(request, mockEnv as Env)
      expect(response.status).toBe(200)

      const calledRequest = mockFetch.mock.calls[0][0] as Request
      expect(calledRequest.headers.get('X-Auth')).toBe('${API_TOKEN}')
    })
  })

  describe('custom Authorization headers', () => {
    it('should add Authorization header from custom headers when different auth header is used for auth', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        auth: 'secret-api-key',
        authHeader: 'X-API-Key',
        headers: { 'Authorization': 'Bearer downstream-token' }
      })

      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('https://proxy.example.com/api/users', {
        headers: { 'X-API-Key': 'secret-api-key' }
      })

      const response = await worker.fetch(request, mockEnv)
      expect(response.status).toBe(200)

      const calledRequest = mockFetch.mock.calls[0][0] as Request
      expect(calledRequest.headers.get('Authorization')).toBe('Bearer downstream-token')
      expect(calledRequest.headers.get('X-API-Key')).toBeNull()
    })

    it('should add custom Authorization header when incoming Authorization is removed for security', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        auth: 'Bearer required-auth',
        headers: { 'Authorization': 'Bearer custom-downstream-token' }
      })

      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('https://proxy.example.com/api/users', {
        headers: { 'Authorization': 'Bearer required-auth' }
      })

      const response = await worker.fetch(request, mockEnv)
      expect(response.status).toBe(200)

      const calledRequest = mockFetch.mock.calls[0][0] as Request
      // The incoming Authorization header should be removed (security) and
      // the custom Authorization header should be added
      expect(calledRequest.headers.get('Authorization')).toBe('Bearer custom-downstream-token')
    })
  })

  describe('multiple authentication headers', () => {
    it('should deny access when no auth headers match', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        authConfigs: [
          { header: 'Authorization', value: 'Bearer token123' },
          { header: 'X-API-Key', value: 'secret-key-456' }
        ]
      })

      const request = new Request('https://proxy.example.com/api/users', {
        headers: { 'Authorization': 'Bearer wrong-token' }
      })

      const response = await worker.fetch(request, mockEnv)
      expect(response.status).toBe(401)
      expect(await response.text()).toBe('{"error":"Unauthorized: Invalid or missing credentials."}')
    })

    it('should allow access when any auth header matches (new simplified logic)', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        authConfigs: [
          { header: 'Authorization', value: 'Bearer token123' },
          { header: 'X-API-Key', value: 'secret-key-456' }
        ]
      })

      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('https://proxy.example.com/api/users', {
        headers: { 'X-API-Key': 'secret-key-456' }
      })

      const response = await worker.fetch(request, mockEnv)
      expect(response.status).toBe(200)
    })

    it('should deny access when no auth headers are present (new simplified logic)', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        authConfigs: [
          { header: 'Authorization', value: 'Bearer token123' },
          { header: 'X-API-Key', value: 'secret-key-456' }
        ]
      })

      const request = new Request('https://proxy.example.com/api/users')

      const response = await worker.fetch(request, mockEnv)
      expect(response.status).toBe(401)
      expect(await response.text()).toBe('{"error":"Unauthorized: Invalid or missing credentials."}')
    })

    it('should remove all configured auth headers from downstream request', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        authConfigs: [
          { header: 'Authorization', value: 'Bearer token123' },
          { header: 'X-API-Key', value: 'secret-key-456' }
        ]
      })

      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      const request = new Request('https://proxy.example.com/api/users', {
        headers: {
          'Authorization': 'Bearer token123',
          'X-API-Key': 'secret-key-456',
          'X-Other': 'should-pass-through'
        }
      })

      const response = await worker.fetch(request, mockEnv)
      expect(response.status).toBe(200)

      const calledRequest = mockFetch.mock.calls[0][0] as Request
      expect(calledRequest.headers.get('Authorization')).toBeNull()
      expect(calledRequest.headers.get('X-API-Key')).toBeNull()
      expect(calledRequest.headers.get('X-Other')).toBe('should-pass-through')
    })

    it('should merge legacy auth with authConfigs when no header conflict', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        auth: 'Bearer legacy-token',
        authHeader: 'X-Legacy-Auth',
        authConfigs: [
          { header: 'Authorization', value: 'Bearer new-token' }
        ]
      })

      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      // Test with new auth header
      const request1 = new Request('https://proxy.example.com/api/users', {
        headers: { 'Authorization': 'Bearer new-token' }
      })

      const response1 = await worker.fetch(request1, mockEnv)
      expect(response1.status).toBe(200)

      // Test with legacy auth header
      const request2 = new Request('https://proxy.example.com/api/users', {
        headers: { 'X-Legacy-Auth': 'Bearer legacy-token' }
      })

      const response2 = await worker.fetch(request2, mockEnv)
      expect(response2.status).toBe(200)
    })

    it('should not merge legacy auth when header conflict exists', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        auth: 'Bearer legacy-token',
        authConfigs: [
          { header: 'Authorization', value: 'Bearer new-token' }
        ]
      })

      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)

      // Should only work with new auth config
      const request1 = new Request('https://proxy.example.com/api/users', {
        headers: { 'Authorization': 'Bearer new-token' }
      })

      const response1 = await worker.fetch(request1, mockEnv)
      expect(response1.status).toBe(200)

      // Legacy token should not work (conflict was skipped)
      const request2 = new Request('https://proxy.example.com/api/users', {
        headers: { 'Authorization': 'Bearer legacy-token' }
      })

      const response2 = await worker.fetch(request2, mockEnv)
      expect(response2.status).toBe(401)
    })

    it('should validate authConfigs structure', async () => {
      const invalidConfig = {
        url: 'https://api.example.com',
        authConfigs: [
          { header: '', value: 'token123' }, // invalid empty header
          { header: 'X-API-Key', value: '' } // invalid empty value
        ]
      }
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(invalidConfig)

      const request = new Request('https://proxy.example.com/api/test')
      const response = await worker.fetch(request, mockEnv)
      expect(response.status).toBe(500)
      expect(await response.text()).toContain('Configuration invalid')
    })
  })
  })
})
