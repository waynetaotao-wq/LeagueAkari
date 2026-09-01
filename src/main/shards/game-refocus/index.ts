import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import { z } from 'zod'

import { GameClientMain } from '../game-client'
import { LeagueClientMain } from '../league-client'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'
import { GAME_REFOCUS_MAIN_NAMESPACE, type GameRefocusMainContext } from './context'
import { GameRefocusController } from './game-refocus-controller'
import { GameRefocusSettings, GameRefocusState } from './state'

/**
 * [lolps] 复活自动切回游戏（见 context.ts 说明）
 */
@Shard(GameRefocusMain.id)
export class GameRefocusMain implements IAkariShardInitDispose {
  static id = GAME_REFOCUS_MAIN_NAMESPACE

  public readonly settings = new GameRefocusSettings()
  public readonly state: GameRefocusState

  private readonly _logger: AkariLogger
  private readonly _settingService: SetterSettingService<GameRefocusSettings>
  private readonly _context: GameRefocusMainContext
  private readonly _controller: GameRefocusController

  constructor(
    private readonly _gameClient: GameClientMain,
    _loggerFactory: LoggerFactoryMain,
    private readonly _leagueClient: LeagueClientMain,
    private readonly _mobxUtils: MobxUtilsMain,
    _settingFactory: SettingFactoryMain
  ) {
    this._logger = _loggerFactory.create(GameRefocusMain.id)
    this._settingService = _settingFactory.register(
      GameRefocusMain.id,
      {
        enabled: {
          default: true,
          schema: z.boolean(),
          sideEffect: ({ value }) => this._controller.applyEnabledSettingSideEffect(value)
        }
      },
      this.settings
    )
    this.state = new GameRefocusState()

    this._context = {
      namespace: GameRefocusMain.id,
      gameClient: this._gameClient,
      leagueClient: this._leagueClient,
      logger: this._logger,
      mobxUtils: this._mobxUtils,
      settings: this.settings,
      settingService: this._settingService,
      state: this.state
    }
    this._controller = new GameRefocusController(this._context)
  }

  async onInit() {
    await this._settingService.applyToState()

    this._mobxUtils.propSync(GameRefocusMain.id, 'state', this.state, [
      'supported',
      'lastTriggeredAt'
    ])
    this._mobxUtils.propSync(GameRefocusMain.id, 'settings', this.settings, ['enabled'])

    this._controller.watch()
  }

  async onDispose() {
    this._controller.dispose()
  }
}
