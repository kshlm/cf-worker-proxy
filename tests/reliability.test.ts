import { describe, it, expect, vi, beforeEach } from 'vitest'
import worker from '../src/index'
import { checkTwoTierAuth } from '../src/request-processor'
import { loadGlobalAuthFromEnv, loadGlobalAuthFromKV } from '../src/utils/global-auth'
import { interpolateSecret } from '../src/secret-interpolation'
import { Env, AuthConfig } from '../src/types'

const mockFetch = vi.fn()
global.fetch = mockFetch

function makeEnv(kv: Record<string, unknown> = {}): Env {
  return {
    PROXY_SERVERS: {
      get: vi.fn(async (key: string) => (key in kv ? kv[key] : null))
    }
  } as unknown as Env
}

describe('reliability hardening', () => {
  let mockEnv: Env

  beforeEach(() => {
    mockEnv = makeEnv()
    vi.clearAllMocks()
  })

  describe('fail-closed global auth', () => {
    it('treats empty-array GLOBAL_AUTH_CONFIGS as configured: server with no per-server auth gets 401', async () => {
      mockEnv.GLOBAL_AUTH_CONFIGS = '[]'
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) =>
        key === 'api' ? { url: 'https://api.example.com' } : null
      )

      const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
      expect(response.status).toBe(401)
    })

    it('returns 500 for malformed GLOBAL_AUTH_CONFIGS and never falls back to per-server auth', async () => {
      mockEnv.GLOBAL_AUTH_CONFIGS = 'not-json'
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) =>
        key === 'api'
          ? { url: 'https://api.example.com', authConfigs: [] } // would allow open access if degraded
          : null
      )

      const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
      expect(response.status).toBe(500)
    })

    it('returns 500 for invalid global auth structure', async () => {
      mockEnv.GLOBAL_AUTH_CONFIGS = JSON.stringify([{ header: '', value: '' }])
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) =>
        key === 'api' ? { url: 'https://api.example.com' } : null
      )

      const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
      expect(response.status).toBe(500)
    })

    it('reports error when env is set but KV also fails to load is irrelevant; absent env falls back to KV', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(JSON.stringify([
        { header: 'Authorization', value: 'Bearer kv-token' }
      ]))
      const result = await loadGlobalAuthConfigurationHelper(mockEnv)
      expect(result.state).toBe('configured')
      expect(result.configs).toEqual([{ header: 'Authorization', value: 'Bearer kv-token' }])
    })

    it('loadGlobalAuthFromEnv reports configured state for empty array', async () => {
      mockEnv.GLOBAL_AUTH_CONFIGS = '[]'
      const result = await loadGlobalAuthFromEnv(mockEnv)
      expect(result.state).toBe('configured')
      expect(result.configs).toEqual([])
    })

    it('loadGlobalAuthFromEnv reports absent when env unset', async () => {
      const result = await loadGlobalAuthFromEnv(mockEnv)
      expect(result.state).toBe('absent')
    })

    it('loadGlobalAuthFromKV reports absent when KV key missing', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue(null)
      const result = await loadGlobalAuthFromKV(mockEnv)
      expect(result.state).toBe('absent')
    })

    it('checkTwoTierAuth denies when global configured with empty configs and no per-server auth', () => {
      const request = new Request('https://proxy.example.com/api/x')
      const result = checkTwoTierAuth(request, true, [], [])
      expect(result.authenticated).toBe(false)
    })

    it('checkTwoTierAuth allows when global not configured and no per-server auth', () => {
      const request = new Request('https://proxy.example.com/api/x')
      const result = checkTwoTierAuth(request, false, [], [])
      expect(result.authenticated).toBe(true)
    })

    it('checkTwoTierAuth allows valid global auth when configured', () => {
      const configs: AuthConfig[] = [{ header: 'Authorization', value: 'Bearer t' }]
      const request = new Request('https://proxy.example.com/api/x', {
        headers: { Authorization: 'Bearer t' }
      })
      const result = checkTwoTierAuth(request, true, configs, [])
      expect(result.authenticated).toBe(true)
      expect(result.usedGlobalAuth).toBe(true)
    })

    it('checkTwoTierAuth allows per-server auth when global configured but per-server matches', () => {
      const request = new Request('https://proxy.example.com/api/x', {
        headers: { 'X-API-Key': 'k' }
      })
      const result = checkTwoTierAuth(
        request,
        true,
        [{ header: 'Authorization', value: 'Bearer global' }],
        [{ header: 'X-API-Key', value: 'k' }]
      )
      expect(result.authenticated).toBe(true)
      expect(result.usedGlobalAuth).toBe(false)
    })
  })

  describe('reserved global-auth-configs key', () => {
    it('cannot be used as a route server key even when it holds valid global auth', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) =>
        key === 'global-auth-configs'
          ? JSON.stringify([{ header: 'Authorization', value: 'Bearer global' }])
          : null
      )

      const response = await worker.fetch(
        new Request('https://proxy.example.com/global-auth-configs/x', {
          headers: { Authorization: 'Bearer global' }
        }),
        mockEnv
      )
      expect(response.status).toBe(404)
    })
  })

  describe('legacy auth fields rejected fail-closed', () => {
    it.each([
      ['auth', { url: 'https://api.example.com', auth: 'Bearer x' }],
      ['authHeader', { url: 'https://api.example.com', authHeader: 'X-API-Key' }]
    ])('rejects config with %s field', async (_field, config) => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) =>
        key === 'api' ? config : null
      )

      const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
      expect(response.status).toBe(500)
    })
  })

  describe('header handling', () => {
    it('configured headers override client headers', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) =>
        key === 'api'
          ? { url: 'https://api.example.com', headers: { 'X-Override': 'from-config' } }
          : null
      )
      mockFetch.mockResolvedValue(new Response('ok'))

      await worker.fetch(
        new Request('https://proxy.example.com/api/x', { headers: { 'X-Override': 'from-client' } }),
        mockEnv
      )

      const called = mockFetch.mock.calls[0][0] as Request
      expect(called.headers.get('X-Override')).toBe('from-config')
    })

    it('strips Host and hop-by-hop headers', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) => key === 'api' ? { url: 'https://api.example.com' } : null)
      mockFetch.mockResolvedValue(new Response('ok'))

      await worker.fetch(
        new Request('https://proxy.example.com/api/x', {
          headers: {
            Host: 'proxy.example.com',
            Connection: 'keep-alive',
            'Keep-Alive': 'timeout=5',
            'Proxy-Authenticate': 'Basic',
            'Proxy-Authorization': 'Basic xxx',
            'TE': 'trailers',
            'Trailer': 'X-Sum',
            'Transfer-Encoding': 'chunked',
            Upgrade: 'websocket',
            'X-Keep': 'yes'
          }
        }),
        mockEnv
      )

      const called = mockFetch.mock.calls[0][0] as Request
      for (const h of ['Host', 'Connection', 'Keep-Alive', 'Proxy-Authenticate', 'Proxy-Authorization', 'TE', 'Trailer', 'Transfer-Encoding', 'Upgrade']) {
        expect(called.headers.get(h)).toBeNull()
      }
      expect(called.headers.get('X-Keep')).toBe('yes')
    })

    it('uses manual redirects so credentials are not replayed cross-origin', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) =>
        key === 'api'
          ? { url: 'https://api.example.com', headers: { Authorization: 'Bearer configured-token' } }
          : null
      )
      mockFetch.mockResolvedValue(new Response('ok'))

      await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)

      const called = mockFetch.mock.calls[0][0] as Request
      expect(called.redirect).toBe('manual')
    })

    it('rejects configured header with invalid name characters', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        headers: { 'Bad Header\n': 'v' }
      })

      const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
      expect(response.status).toBe(500)
    })

    it('rejects configured header with control characters in value', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockResolvedValue({
        url: 'https://api.example.com',
        headers: { 'X-Bad': 'value\r\ninjected: yes' }
      })

      const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
      expect(response.status).toBe(500)
    })

    it('preserves streaming body', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) => key === 'api' ? { url: 'https://api.example.com' } : null)
      mockFetch.mockResolvedValue(new Response('ok'))

      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('chunk'))
          controller.close()
        }
      })

      await worker.fetch(
        new Request('https://proxy.example.com/api/x', { method: 'POST', body, duplex: 'half' } as RequestInit),
        mockEnv
      )

      const called = mockFetch.mock.calls[0][0] as Request
      expect(called.body).toBeTruthy()
      expect((called.body as ReadableStream).locked).toBe(false)
    })

    it('composes backend URL without dropping path or duplicating slashes', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) => key === 'api' ? { url: 'https://api.example.com/base/' } : null)
      mockFetch.mockResolvedValue(new Response('ok'))

      await worker.fetch(new Request('https://proxy.example.com/api/users/1?q=2'), mockEnv)

      const called = mockFetch.mock.calls[0][0] as Request
      expect(called.url).toBe('https://api.example.com/base/users/1?q=2')
    })

    it('keeps root path requests pointing at base URL root', async () => {
      vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) => key === 'api' ? { url: 'https://api.example.com' } : null)
      mockFetch.mockResolvedValue(new Response('ok'))

      await worker.fetch(new Request('https://proxy.example.com/api/'), mockEnv)

      const called = mockFetch.mock.calls[0][0] as Request
      expect(called.url).toBe('https://api.example.com/')
    })
  })

  describe('secret interpolation', () => {
    it('interpolates only string env values; non-string env values are treated as missing', () => {
      const env = { TOKEN: 'good', OBJ: { malicious: true } } as unknown as Env
      expect(interpolateSecret('${TOKEN}', env)).toBe('good')
      expect(interpolateSecret('${OBJ}', env)).toBe('${OBJ}')
    })
  })
})

async function loadGlobalAuthConfigurationHelper(env: Env) {
  const { loadGlobalAuthConfiguration } = await import('../src/utils/global-auth')
  return loadGlobalAuthConfiguration(env)
}

describe('runtime review findings', () => {
  let mockEnv: Env

  beforeEach(() => {
    mockEnv = makeEnv()
    vi.clearAllMocks()
  })

  function serverConfig(config: unknown) {
    return vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) =>
      key === 'api' ? config : key === 'global-auth-configs' ? null : null
    )
  }

  it('returns 503-ish generic 500 for KV retrieval failures (not 404)', async () => {
    vi.mocked(mockEnv.PROXY_SERVERS.get).mockImplementation(async (key: string) => {
      if (key === 'api') throw new Error('KV internal error')
      return null
    })

    const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('{"error":"Configuration invalid: Server setup requires review."}')
  })

  it('returns 404 for missing route and generic 500 for malformed KV JSON', async () => {
    serverConfig('not-valid-json-at-all' as unknown)
    // KV with type json would return the raw string when JSON is invalid;
    // malformed structure (string instead of object) must give generic 500.
    const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('{"error":"Configuration invalid: Server setup requires review."}')
  })

  it('type-guards malformed auth entries: non-array authConfigs gives generic 500, no TypeError', async () => {
    serverConfig({ url: 'https://api.example.com', authConfigs: 'oops' })

    const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body).toBe('{"error":"Configuration invalid: Server setup requires review."}')
  })

  it('type-guards malformed auth entries: entry missing fields gives generic 500', async () => {
    serverConfig({ url: 'https://api.example.com', authConfigs: [null] })

    const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('{"error":"Configuration invalid: Server setup requires review."}')
  })

  it('type-guards malformed auth entries before auth matching: entry with non-string header does not crash', async () => {
    serverConfig({ url: 'https://api.example.com', authConfigs: [{ header: 42 }] })

    const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
    expect(response.status).toBe(500)
  })

  it('validation failure returns generic config-invalid body, no internals leaked', async () => {
    serverConfig({ url: 'https://api.example.com', authConfigs: [{ header: 'bad header', value: 'v' }] })

    const response = await worker.fetch(new Request('https://proxy.example.com/api/x'), mockEnv)
    expect(response.status).toBe(500)
    // Details like the invalid header name go to logs, not the response body
    const body = await response.text()
    expect(body).toBe('{"error":"Configuration invalid: Server setup requires review."}')
    expect(body).not.toContain('bad header')
  })
})
