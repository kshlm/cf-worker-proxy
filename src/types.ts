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

export interface RequestContext {
  request: Request
  serverKey: string
  pathname: string
  originalUrl: string
}

export interface ErrorDetails {
  message: string
  status: number
  context?: string
}

export interface KVOperationResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}