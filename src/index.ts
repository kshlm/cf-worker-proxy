import { getServerKey, buildBackendUrl } from './router'
import { checkAuth } from './auth'
import { ServerConfig, Env, ServersConfig } from './types'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)
      const pathname = url.pathname
      
      // Extract server key from path
      const serverKey = getServerKey(pathname)
      if (!serverKey) {
        return new Response('Not Found', { status: 404 })
      }
      
      // Get server configuration from KV
      let servers: ServersConfig
      try {
        const serversData = await env.PROXY_SERVERS.get('servers', { type: 'json' })
        servers = (serversData as ServersConfig) ?? {}
      } catch (error) {
        console.error('Failed to retrieve servers configuration:', error)
        return new Response('Configuration error', { status: 500 })
      }
      
      const config: ServerConfig | undefined = servers[serverKey]
      if (!config) {
        return new Response('Server not found', { status: 404 })
      }
      
      // Validate backend URL
      let backendUrl: URL
      try {
        backendUrl = new URL(config.url)
        if (backendUrl.protocol !== 'https:') {
          throw new Error('Only HTTPS URLs are allowed')
        }
      } catch (error) {
        console.error(`Invalid backend URL for server ${serverKey}:`, error)
        return new Response('Configuration error', { status: 500 })
      }
      
      // Check authentication
      if (!checkAuth(request, config.auth)) {
        return new Response('Authentication required', { status: 401 })
      }
      
      // Build backend URL
      const targetUrl = buildBackendUrl(config.url, request.url, serverKey)
      
      // Create modified request
      const modifiedHeaders = new Headers(request.headers)
      
      // Add custom headers from config
      if (config.headers) {
        Object.entries(config.headers).forEach(([key, value]) => {
          modifiedHeaders.set(key, value)
        })
      }
      
      const modifiedRequest = new Request(targetUrl, {
        method: request.method,
        headers: modifiedHeaders,
        body: request.body,
        redirect: request.redirect,
      } as RequestInit)
      
      // Forward request to backend
      try {
        const response = await fetch(modifiedRequest)
        return response
      } catch (error) {
        console.error(`Failed to fetch from backend for server ${serverKey}:`, error)
        return new Response('Bad Gateway', { status: 502 })
      }
      
    } catch (error) {
      console.error('Unexpected error:', error)
      return new Response('Internal Server Error', { status: 500 })
    }
  }
}