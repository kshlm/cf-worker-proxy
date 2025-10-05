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