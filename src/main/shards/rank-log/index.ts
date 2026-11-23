import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import type { RankLogQueryDto } from '@shared/shards/rank-log'
import { z } from 'zod'

import { AkariIpcMain } from '../ipc'
import { LeagueClientMain } from '../league-client'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'
import { SgpMain } from '../sgp'
import { StorageMain } from '../storage'
import { RankLogClientDataLoader } from './client-data-loader'
import { RANK_LOG_MAIN_NAMESPACE, type RankLogMainContext } from './context'
import { RankLogEntryLoader } from './entry-loader'
import { RankLogIpcHandlers } from './ipc-handlers'
import { RankLogController } from './rank-log-controller'
import { RankLogSettings, RankLogState } from './state'

/**
 * [lolps] 上分日志（见 context.ts 说明）
 */
@Shard(RankLogMain.id)
export class RankLogMain implements IAkariShardInitDispose {
  static id = RANK_LOG_MAIN_NAMESPACE

  public readonly settings = new RankLogSettings()
  public readonly state = new RankLogState()

  private readonly _logger: AkariLogger
  private readonly _settingService: SetterSettingService<RankLogSettings>
  private readonly _context: RankLogMainContext
  private readonly _entryLoader: RankLogEntryLoader
  private readonly _controller: RankLogController
  private readonly _ipcHandlers: RankLogIpcHandlers

  constructor(
    private readonly _ipc: AkariIpcMain,
    private readonly _leagueClient: LeagueClientMain,
    _loggerFactory: LoggerFactoryMain,
    private readonly _mobxUtils: MobxUtilsMain,
    _settingFactory: SettingFactoryMain,
    private readonly _sgp: SgpMain,
    private readonly _storage: StorageMain
  ) {
    this._logger = _loggerFactory.create(RankLogMain.id)
    this._settingService = _settingFactory.register(
      RankLogMain.id,
      {
        enabled: { default: this.settings.enabled, schema: z.boolean() }
      },
      this.settings
    )

    this._context = {
      namespace: RankLogMain.id,
      logger: this._logger,
      ipc: this._ipc,
      mobxUtils: this._mobxUtils,
      leagueClient: this._leagueClient,
      sgp: this._sgp,
      storage: this._storage,
      settings: this.settings,
      state: this.state
    }
    this._entryLoader = new RankLogEntryLoader(this._storage)
    this._controller = new RankLogController(
      this._context,
      this._entryLoader,
      new RankLogClientDataLoader(this._context)
    )
    this._ipcHandlers = new RankLogIpcHandlers(this._context, this._entryLoader, this._controller)
  }

  async onInit() {
    await this._settingService.applyToState()
    this.state.setAvailable(this._storage.isLolpsSchemaReady)

    this._mobxUtils.propSync(RankLogMain.id, 'settings', this.settings, ['enabled'])
    this._mobxUtils.propSync(RankLogMain.id, 'state', this.state, [
      'available',
      'revision',
      'syncing',
      'lastSyncedAt'
    ])
    this._ipcHandlers.register()

    if (this.state.available) {
      this._controller.watch()
    } else {
      this._logger.warn('Rank log table is unavailable, recording stays off')
    }
  }

  async onDispose() {
    this._controller.dispose()
  }

  /** Newest first; for other main-process features that read the log. */
  queryEntries(query: RankLogQueryDto) {
    return this._entryLoader.query(query)
  }
}
