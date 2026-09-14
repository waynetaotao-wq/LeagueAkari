import type { HttpProxySetting } from '@shared/shards/network'
import { formatError } from '@shared/utils/errors'
import type { ProxyConfig } from 'electron'

import type { NetworkMainContext, NetworkSession } from './context'

export function resolveNetworkProxyConfig(setting: HttpProxySetting): ProxyConfig {
  switch (setting.strategy) {
    case 'system':
      return { mode: 'system' }
    case 'fixed-servers':
      return {
        mode: 'fixed_servers',
        proxyRules: `${setting.host}:${setting.port}`
      }
    case 'direct':
      return { mode: 'direct' }
  }
}

export class NetworkProxyController {
  private _disposeReaction: (() => void) | null = null
  private _configurationQueue: Promise<void> = Promise.resolve()
  private readonly _sessions = new Set<NetworkSession>()
  private readonly _configuredSessions = new WeakSet<NetworkSession>()

  constructor(private readonly _context: NetworkMainContext) {
    this._sessions.add(_context.electronSession)
  }

  addSession(electronSession: NetworkSession) {
    if (this._sessions.has(electronSession)) return
    this._sessions.add(electronSession)
    if (this._disposeReaction) {
      this._scheduleConfiguration(this._context.settings.httpProxy, [electronSession])
    }
  }

  start() {
    if (this._disposeReaction) return

    this._disposeReaction = this._context.mobxUtils.reaction(
      () => this._context.settings.httpProxy,
      (setting) => this._scheduleConfiguration(setting),
      { fireImmediately: true }
    )
  }

  waitUntilConfigured() {
    return this._configurationQueue
  }

  dispose() {
    this._disposeReaction?.()
    this._disposeReaction = null
  }

  private _scheduleConfiguration(setting: HttpProxySetting, sessions = [...this._sessions]) {
    const config = resolveNetworkProxyConfig(setting)
    const task = this._configurationQueue
      .catch(() => undefined)
      .then(async () => {
        await Promise.all(
          sessions.map((electronSession) => this._applyConfiguration(electronSession, config))
        )
      })

    this._configurationQueue = task
    void task.catch((error) => {
      this._context.logger.warn('Failed to configure network proxy', formatError(error))
    })
  }

  private async _applyConfiguration(electronSession: NetworkSession, config: ProxyConfig) {
    await electronSession.setProxy(config)

    if (this._configuredSessions.has(electronSession)) {
      try {
        await electronSession.closeAllConnections()
      } catch (error) {
        this._context.logger.warn(
          'Failed to close network connections after proxy change',
          formatError(error)
        )
      }
    }

    this._configuredSessions.add(electronSession)
  }
}
