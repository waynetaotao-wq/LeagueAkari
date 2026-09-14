export const NETWORK_MAIN_NAMESPACE = 'network-main'

export interface HttpProxySetting {
  strategy: 'system' | 'fixed-servers' | 'direct'
  port: number
  host: string
}

export const DEFAULT_HTTP_PROXY_SETTING: HttpProxySetting = {
  strategy: 'direct',
  port: 7890,
  host: '127.0.0.1'
}
