export interface ServerConfig {
  url: string
  headers?: Record<string, string>
  auth?: string
  authHeader?: string
}

export interface ServersConfig {
  [serverKey: string]: ServerConfig
}

export interface Env {
  PROXY_SERVERS: KVNamespace
  [key: string]: string | KVNamespace | undefined
}

/**
 * Enhanced type for processed server configuration with interpolated secrets
 */
export interface ProcessedServerConfig extends ServerConfig {
  // Same as ServerConfig but all secrets have been interpolated
}

/**
 * Request processing context for better type safety
 */
export interface RequestContext {
  request: Request
  serverKey: string
  pathname: string
  originalUrl: string
}

/**
 * Error details for better error handling
 */
export interface ErrorDetails {
  message: string
  status: number
  context?: string
}

/**
 * KV operation result wrapper
 */
export interface KVOperationResult<T = any> {
  success: boolean
  data?: T
  error?: string
}