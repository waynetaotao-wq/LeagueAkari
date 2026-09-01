import type { GameClientMain } from '../game-client'
import type { LeagueClientMain } from '../league-client'
import type { AkariLogger } from '../logger-factory'
import type { MobxUtilsMain } from '../mobx-utils'
import type { SetterSettingService } from '../setting-factory/setter-setting-service'
import type { GameRefocusSettings, GameRefocusState } from './state'

/**
 * [lolps] 复活自动切回游戏
 *
 * 死亡后若人在别的窗口，复活前自动把游戏窗口拉回前台。
 * 数据来自 Riot 官方 Live Client Data API（与原版“复活计时器”同源），
 * 切窗只做操作系统层面的窗口激活（等价于 Alt+Tab），全程不模拟任何按键或鼠标事件。
 */
export const GAME_REFOCUS_MAIN_NAMESPACE = 'game-refocus-main'

/** 存活时 1 秒一查；死亡后加密到 500ms，让“复活前 N 秒”的触发点更准 */
export const GAME_REFOCUS_POLL_ALIVE_MS = 1000
export const GAME_REFOCUS_POLL_DEAD_MS = 500

/** 复活前几秒切回（可调区） */
export const GAME_REFOCUS_LEAD_SECONDS = 2

/** 同一次死亡两次激活之间的最小间隔（防止极端情况下重复拉起 PowerShell） */
export const GAME_REFOCUS_MIN_ACTIVATE_GAP_MS = 5000

export interface GameRefocusMainContext {
  namespace: string
  gameClient: GameClientMain
  leagueClient: LeagueClientMain
  logger: AkariLogger
  mobxUtils: MobxUtilsMain
  settings: GameRefocusSettings
  settingService: SetterSettingService<GameRefocusSettings>
  state: GameRefocusState
}
