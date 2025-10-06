import { getServerKey, buildBackendUrl } from './router'
import { checkAuth } from './auth'
import { ServerConfig, Env } from './types'

/**
 * Interpolates secrets into a string using ${SECRET_NAME} pattern.
 * Falls back to original placeholder if secret is missing.
 * Returns null if any required secret is missing (for auth fields).
 */
function interpolateSecrets(value: string, env: Env, isAuth: boolean = false): string | null {
  const result = value.replace(/\$\{([\w-]+)\}/g, (match, secretName) => {
    const secretValue = env[secretName] as string | undefined
    if (secretValue !== undefined) {
      return secretValue
    }

    // For auth fields, missing secrets should cause failure
    if (isAuth) {
      throw new Error(`Missing required secret: ${secretName}`)
    }

    // For headers, fallback to placeholder
    return match
  })

  return result
}

/**
 * Processes a server config by interpolating secrets in auth and headers.
 * Throws error if required auth secrets are missing.
 */
function processServerConfig(config: ServerConfig, env: Env): ServerConfig {
  const processed = { ...config }

  if (processed.auth) {
    try {
      const interpolatedAuth = interpolateSecrets(processed.auth, env, true)
      if (interpolatedAuth === null) {
        throw new Error('Auth interpolation failed')
      }
      processed.auth = interpolatedAuth
    } catch {
      throw new Error('Missing required authentication secret')
    }
  }

  if (processed.headers) {
    processed.headers = Object.fromEntries(
      Object.entries(processed.headers).map(([key, value]) => [
        key,
        interpolateSecrets(value, env, false) ?? value
      ])
    )
  }

  return processed
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)
      const pathname = url.pathname

      // Extract server key from path
      const serverKey = getServerKey(pathname)
      if (!serverKey) {
        return new Response(
          JSON.stringify({ error: "Invalid route: No server configured for this path." }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }

      // Get server configuration from KV
      let config: ServerConfig | undefined
      try {
        const serverData = await env.PROXY_SERVERS.get(serverKey, { type: 'json' })
        config = serverData as ServerConfig
      } catch (error) {
        console.error(`KV retrieval failed for path "${pathname}" (server: ${serverKey}):`, error)
        return new Response(
          JSON.stringify({ error: "Service unavailable: Unable to load configuration." }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }

      if (!config) {
        return new Response(
          JSON.stringify({ error: "Server not found: No configuration available for this route." }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }

      // Process config with secret interpolation
      let processedConfig: ServerConfig
      try {
        processedConfig = processServerConfig(config, env)
      } catch (error) {
        console.error(`Config processing failed for server "${serverKey}" (path: "${pathname}"):`, error)
        return new Response(
          JSON.stringify({ error: "Configuration invalid: Server setup requires review." }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }

      // Validate backend URL
      let backendUrl: URL
      try {
        backendUrl = new URL(processedConfig.url)
        if (backendUrl.protocol !== 'https:') {
          throw new Error('Only HTTPS URLs are allowed')
        }
      } catch (error) {
        console.error(`URL validation failed for server "${serverKey}" (path: "${pathname}"):`, error)
        return new Response(
          JSON.stringify({ error: "Configuration invalid: Backend URL is malformed or insecure." }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }

      // Check authentication
      if (!checkAuth(request, processedConfig.auth, processedConfig.authHeader)) {
        const authHeaderName = processedConfig.authHeader || 'Authorization'
        console.warn(`Authentication failed for server "${serverKey}" (path: "${pathname}") using ${authHeaderName} header`)
        return new Response(
          JSON.stringify({ error: "Unauthorized: Invalid or missing credentials." }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }

      // Build backend URL
      const targetUrl = buildBackendUrl(processedConfig.url, request.url, serverKey)

      // Create modified request
      const modifiedHeaders = new Headers()

      // Determine which auth header to exclude
      const authHeaderName = processedConfig.authHeader || 'Authorization'

      // Copy all incoming headers, excluding the auth header
      for (const [key, value] of request.headers.entries()) {
        if (key.toLowerCase() !== authHeaderName.toLowerCase()) {
          modifiedHeaders.set(key, value)
        }
      }

      // Add custom headers from config only if they don't already exist
      if (processedConfig.headers) {
        Object.entries(processedConfig.headers).forEach(([key, value]) => {
          if (!request.headers.has(key)) {
            modifiedHeaders.set(key, value)
          }
        })
      }
      console.debug(`[downstream] ${JSON.stringify(modifiedHeaders)}`)

      const modifiedRequest = new Request(targetUrl, {
        method: request.method,
        headers: modifiedHeaders,
        body: request.body,
        redirect: request.redirect,
        duplex: 'half'
      } as RequestInit)

      // Forward request to backend
      try {
        const response = await fetch(modifiedRequest)
        return response
      } catch (error) {
        console.error(`Backend fetch failed for server "${serverKey}" (path: "${pathname}", target: "${new URL(targetUrl).origin}"):`, error)
        return new Response(
          JSON.stringify({ error: "Backend unavailable: Target server is unreachable." }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }

    } catch (error) {
      console.error(`Unexpected error handling request to "${request.url}":`, error)
      return new Response(
        JSON.stringify({ error: "Internal server error: An unexpected issue occurred." }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }
  }
}
