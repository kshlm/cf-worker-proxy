import { describe, it, expect, vi, beforeEach } from 'vitest'
import worker, { Env } from '../src/index'

// Mock fetch for testing
global.fetch = vi.fn()

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
    expect(await response.text()).toBe('Not Found')
  })
  
  it('should return 404 for non-existent server', async () => {
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({ api: { url: 'https://api.example.com' } })
    
    const request = new Request('https://proxy.example.com/unknown/path')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Server not found')
  })
  
  it('should return 401 for missing auth when required', async () => {
    const servers = {
      api: {
        url: 'https://api.example.com',
        auth: 'Bearer required-token'
      }
    }
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(servers)
    
    const request = new Request('https://proxy.example.com/api/users')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Authentication required')
  })
  
  it('should proxy request successfully', async () => {
    const servers = {
      api: {
        url: 'https://api.example.com',
        headers: { 'X-Custom': 'value' }
      }
    }
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(servers)
    
    const mockResponse = new Response('Success', { status: 200 })
    vi.mocked(global.fetch).mockResolvedValue(mockResponse)
    
    const request = new Request('https://proxy.example.com/api/users/123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"test": "data"}'
    })
    
    const response = await worker.fetch(request, mockEnv)
    
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Success')
    
    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.example.com/users/123',
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Custom': 'value'
        })
      })
    )
  })
  
  it('should return 500 for KV errors', async () => {
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockRejectedValue(new Error('KV error'))
    
    const request = new Request('https://proxy.example.com/api/test')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Configuration error')
  })
  
  it('should return 500 for invalid backend URL', async () => {
    const servers = {
      api: {
        url: 'not-a-valid-url'
      }
    }
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(servers)
    
    const request = new Request('https://proxy.example.com/api/test')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Configuration error')
  })
  
  it('should return 500 for non-HTTPS URLs', async () => {
    const servers = {
      api: {
        url: 'http://api.example.com'
      }
    }
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(servers)
    
    const request = new Request('https://proxy.example.com/api/test')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Configuration error')
  })
  
  it('should return 502 for backend fetch errors', async () => {
    const servers = {
      api: {
        url: 'https://api.example.com'
      }
    }
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(servers)
    vi.mocked(global.fetch).mockRejectedValue(new Error('Network error'))
    
    const request = new Request('https://proxy.example.com/api/test')
    const response = await worker.fetch(request, mockEnv)
    expect(response.status).toBe(502)
    expect(await response.text()).toBe('Bad Gateway')
  })
})