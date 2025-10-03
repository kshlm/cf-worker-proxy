export interface ServerConfig {
  url: string
  headers?: Record<string, string>
  auth?: string
}

export interface ServersConfig {
  [serverKey: string]: ServerConfig
}

export interface Env {
  PROXY_SERVERS: KVNamespace
}