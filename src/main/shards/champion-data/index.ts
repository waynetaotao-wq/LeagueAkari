import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import type { ChampionDataPreferences } from '@shared/data-adapter/champion-data'
import { LolpsHttpApiAxiosHelper } from '@shared/http-api-axios-helper/lolps'
import { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import { Qq101HttpApiAxiosHelper } from '@shared/http-api-axios-helper/qq101'
import axios, { type AxiosInstance } from 'axios'
import type { AxiosRetry } from 'axios-retry'
import { z } from 'zod'

import { AppCommonMain } from '../app-common'
import { FeatureGatingMain } from '../feature-gating'
import { AkariIpcMain } from '../ipc'
import { type AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import type { SetterSettingService } from '../setting-factory/setter-setting-service'
import {
  CHAMPION_DATA_MAIN_NAMESPACE,
  CHAMPION_DATA_OPGG_FEATURE_GATE,
  CHAMPION_DATA_QQ101_FEATURE_GATE,
  type ChampionDataMainContext,
  resolveChampionDataSourceGateAvailability
} from './context'
import { ChampionDataCounterIntel } from './counter-intel'
import { ChampionDataIpcHandlers } from './ipc-handlers'
import { ChampionDataServiceController } from './service-controller'
import { ChampionDataMainSourceLoader } from './source-loader'
import { ChampionDataSettings, ChampionDataState } from './state'

const axiosRetry = require('axios-retry').default as AxiosRetry

const preferencesSchema: z.ZodType<ChampionDataPreferences> = z.object({
  mode: z.enum(['ranked', 'classic', 'aram', 'aram_mayhem', 'arena', 'nexus_blitz', 'urf']),
  position: z.enum(['all', 'top', 'jungle', 'middle', 'bottom', 'utility', 'none']),
  region: z.string().min(1),
  tier: z.union([z.string(), z.number()])
})

@Shard(ChampionDataMain.id)
export class ChampionDataMain implements IAkariShardInitDispose {
  static id = CHAMPION_DATA_MAIN_NAMESPACE

  public readonly settings = new ChampionDataSettings()
  public readonly state = new ChampionDataState()

  private readonly _logger: AkariLogger
  private readonly _settingService: SetterSettingService<ChampionDataSettings>
  private readonly _context: ChampionDataMainContext
  private readonly _opggHttpClient: AxiosInstance
  private readonly _qq101HttpClient: AxiosInstance
  private readonly _lolpsHttpClient: AxiosInstance
  private readonly _opggWebHttpClient: AxiosInstance
  private readonly _sourceLoader: ChampionDataMainSourceLoader
  private readonly _service: ChampionDataServiceController
  private readonly _ipcHandlers: ChampionDataIpcHandlers
  private readonly _counterIntel: ChampionDataCounterIntel

  constructor(
    private readonly _appCommon: AppCommonMain,
    private readonly _featureGating: FeatureGatingMain,
    private readonly _ipc: AkariIpcMain,
    loggerFactory: LoggerFactoryMain,
    private readonly _mobxUtils: MobxUtilsMain,
    settingFactory: SettingFactoryMain
  ) {
    this._logger = loggerFactory.create(ChampionDataMain.id)
    this._settingService = settingFactory.register(
      ChampionDataMain.id,
      {
        preferredSource: {
          default: this.settings.preferredSource,
          schema: z.enum(['opgg', 'qq101', 'lolps'])
        },
        preferences: { default: this.settings.preferences, schema: preferencesSchema }
      },
      this.settings
    )
    this._opggHttpClient = this._createHttpClient()
    this._qq101HttpClient = this._createHttpClient({
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://101.qq.com/',
      'User-Agent': 'LeagueAkari'
    })
    this._lolpsHttpClient = this._createHttpClient({
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://lol.ps/',
      'User-Agent': 'LeagueAkari'
    })
    const opggApi = new OpggHttpApiAxiosHelper(this._opggHttpClient)
    const qq101Api = new Qq101HttpApiAxiosHelper(this._qq101HttpClient)
    const lolpsApi = new LolpsHttpApiAxiosHelper(this._lolpsHttpClient)
    this._opggWebHttpClient = this._createHttpClient()
    this._counterIntel = new ChampionDataCounterIntel({
      logger: this._logger,
      opggApi,
      web: this._opggWebHttpClient
    })
    this._sourceLoader = new ChampionDataMainSourceLoader(this._logger, opggApi, qq101Api, lolpsApi)
    this._context = {
      namespace: ChampionDataMain.id,
      logger: this._logger,
      mobxUtils: this._mobxUtils,
      settings: this.settings,
      state: this.state,
      settingService: this._settingService
    }
    this._service = new ChampionDataServiceController(this._context, this._sourceLoader)
    this._ipcHandlers = new ChampionDataIpcHandlers(this._context, this._ipc, this._service)
  }

  async onInit() {
    await this._settingService.applyToState()
    await this._migrateRegionTierDefaults()
    this._mobxUtils.propSync(ChampionDataMain.id, 'settings', this.settings, [
      'preferredSource',
      'preferences'
    ])
    this._mobxUtils.propSync(ChampionDataMain.id, 'state', this.state, [
      'availability',
      'lastEffectiveSource',
      'lastFallbackReason'
    ])
    this._watchAvailability()
    this._watchHttpProxy()
    this._ipcHandlers.register()
    this._counterIntel.register(this._ipc, ChampionDataMain.id)
  }

  async onDispose() {
    this._ipcHandlers.dispose()
    this._counterIntel.dispose()
  }

  /**
   * [lolps] 一次性迁移：旧存档若仍是官方默认的 global/all，改为 kr/emerald_plus；
   * 之后用户手动选回全地区不会再被覆盖（以 regionTierDefaultsMigrated 标记）。
   */
  private async _migrateRegionTierDefaults() {
    const migrated = await this._settingService._getFromStorage('regionTierDefaultsMigrated')
    if (migrated) return
    const { region, tier } = this.settings.preferences
    if (region === 'global' && String(tier) === 'all') {
      await this._settingService.set('preferences', {
        ...this.settings.preferences,
        region: 'kr',
        tier: 'emerald_plus'
      })
      this._logger.info('[lolps] champion-data preferences migrated to kr / emerald_plus')
    }
    await this._settingService._saveToStorage('regionTierDefaultsMigrated', true)
  }

  loadOverview(query: Parameters<ChampionDataServiceController['loadOverview']>[0]) {
    return this._service.loadOverview(query)
  }

  loadPatches(query: Parameters<ChampionDataServiceController['loadPatches']>[0]) {
    return this._service.loadPatches(query)
  }

  loadDetails(
    query: Parameters<ChampionDataServiceController['loadDetails']>[0],
    championId: number
  ) {
    return this._service.loadDetails(query, championId)
  }

  private _createHttpClient(headers?: Record<string, string>) {
    const client = axios.create({ timeout: 8_000, headers })
    axiosRetry(client, {
      retries: 1,
      shouldResetTimeout: true,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: axiosRetry.isNetworkOrIdempotentRequestError
    })
    return client
  }

  private _watchAvailability() {
    this._mobxUtils.reaction(
      () => {
        const opggConfigured = this._featureGating.hasConfiguredGate(
          CHAMPION_DATA_OPGG_FEATURE_GATE
        )
        const qq101Configured = this._featureGating.hasConfiguredGate(
          CHAMPION_DATA_QQ101_FEATURE_GATE
        )
        const sourceGates = resolveChampionDataSourceGateAvailability({
          opggConfigured,
          qq101Configured,
          opggEnabled: this._featureGating.isEnabled(CHAMPION_DATA_OPGG_FEATURE_GATE, false),
          qq101Enabled: this._featureGating.isEnabled(CHAMPION_DATA_QQ101_FEATURE_GATE, false)
        })
        return {
          preferredSource: this.settings.preferredSource,
          ...sourceGates
        }
      },
      ({ preferredSource, opgg, qq101 }) => {
        this.state.setAvailability({
          preferredSource,
          sources: {
            opgg: { enabled: opgg },
            qq101: { enabled: qq101 },
            lolps: { enabled: true }
          }
        })
      },
      { fireImmediately: true }
    )
  }

  private _watchHttpProxy() {
    this._mobxUtils.reaction(
      () => this._appCommon.settings.httpProxy,
      (httpProxy) => {
        for (const client of [
          this._opggHttpClient,
          this._qq101HttpClient,
          this._lolpsHttpClient,
          this._opggWebHttpClient
        ]) {
          if (httpProxy.strategy === 'force') {
            client.defaults.proxy = { host: httpProxy.host, port: httpProxy.port }
          } else if (httpProxy.strategy === 'disable') {
            client.defaults.proxy = false
          } else {
            client.defaults.proxy = undefined
          }
        }
      },
      { fireImmediately: true }
    )
  }
}
