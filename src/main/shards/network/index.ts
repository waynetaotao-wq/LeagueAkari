import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import type { CreateAxiosDefaults } from 'axios'
import { type Session, app, session } from 'electron'
import { z } from 'zod'

import { type AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import type { SetterSettingService } from '../setting-factory/setter-setting-service'
import { createNetworkAxiosClient } from './axios-client'
import {
  NETWORK_MAIN_NAMESPACE,
  NETWORK_SESSION_PARTITION,
  type NetworkMainContext
} from './context'
import { NetworkProxyController } from './proxy-controller'
import { NetworkSettings } from './state'

@Shard(NetworkMain.id)
export class NetworkMain implements IAkariShardInitDispose {
  static id = NETWORK_MAIN_NAMESPACE

  public readonly settings = new NetworkSettings()
  private readonly _settingService: SetterSettingService<NetworkSettings>
  private readonly _logger: AkariLogger
  private readonly _context: NetworkMainContext
  private readonly _proxyController: NetworkProxyController
  private readonly _onSessionCreated = (electronSession: Session) => {
    this._proxyController.addSession(electronSession)
  }

  constructor(
    settingFactory: SettingFactoryMain,
    loggerFactory: LoggerFactoryMain,
    private readonly _mobxUtils: MobxUtilsMain
  ) {
    this._logger = loggerFactory.create(NetworkMain.id)
    this._settingService = settingFactory.register(
      NetworkMain.id,
      {
        httpProxy: {
          default: this.settings.httpProxy,
          schema: z.object({
            strategy: z.enum(['fixed-servers', 'system', 'direct']),
            port: z.number(),
            host: z.string()
          })
        }
      },
      this.settings
    )
    this._context = {
      namespace: NetworkMain.id,
      settings: this.settings,
      logger: this._logger,
      mobxUtils: this._mobxUtils,
      electronSession: session.fromPartition(NETWORK_SESSION_PARTITION, { cache: false })
    }
    this._proxyController = new NetworkProxyController(this._context)
  }

  createAxiosClient(defaults: CreateAxiosDefaults = {}) {
    return createNetworkAxiosClient(
      this._context.electronSession,
      () => this._proxyController.waitUntilConfigured(),
      defaults
    )
  }

  resolveProxy(url: string) {
    return this._context.electronSession.resolveProxy(url)
  }

  async onInit() {
    await this._settingService.applyToState()
    this._mobxUtils.propSync(NetworkMain.id, 'settings', this.settings, ['httpProxy'])
    app.on('session-created', this._onSessionCreated)
    this._proxyController.addSession(session.defaultSession)
    this._proxyController.start()
  }

  async onDispose() {
    app.off('session-created', this._onSessionCreated)
    this._proxyController.dispose()
    try {
      await this._context.electronSession.closeAllConnections()
    } catch (error) {
      this._logger.warn('Failed to close network connections during disposal', error)
    }
  }
}
