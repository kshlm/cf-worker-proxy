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
    expect(await response.text()).toBe('{"error":"Service unavailable: Unable to load configuration."}')
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
    
    it('should interpolate secrets in headers and forward correctly', async () => {
      const envWithSecret = { ...mockEnv, API_TOKEN: 'Bearer fake-token' }
      vi.mocked(envWithSecret.PROXY_SERVERS.get).mockResolvedValue({
        ...configWithSecrets,
        auth: undefined  // No auth for this test
      })
      
      const mockResponse = new Response('Success', { status: 200 })
      mockFetch.mockResolvedValue(mockResponse)
      
      const request = new Request('https://proxy.example.com/api/users')
      
      const response = await worker.fetch(request, envWithSecret as Env)
      expect(response.status).toBe(200)
      
      const calledRequest = mockFetch.mock.calls[0][0] as Request
      expect(calledRequest.headers.get('X-Auth')).toBe('Bearer fake-token')
      expect(calledRequest.headers.get('X-Static')).toBe('static')
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

})