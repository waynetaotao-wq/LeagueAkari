import type { AkariIpcMain } from '../ipc'
import type { LeagueClientMain } from '../league-client'
import type { AkariLogger } from '../logger-factory'
import type { MobxUtilsMain } from '../mobx-utils'
import type { SgpMain } from '../sgp'
import type { StorageMain } from '../storage'
import type { RankLogSettings, RankLogState } from './state'

/**
 * [lolps] 上分日志
 *
 * 逐局记录本人排位的结果和胜点变化。服务器没有胜点历史接口，所以每一局的涨跌只能在
 * 当时读出来：对局结束后比较客户端给出的段位前后两次读数，差值就是这一局的胜点。
 * 对局的英雄、位置、战绩来自战绩服务，只读。
 */
export const RANK_LOG_MAIN_NAMESPACE = 'rank-log-main'

/** 一局结束后，隔这些时间各读一次段位和战绩：客户端更新胜点通常要几秒，偶尔更久 */
export const RANK_LOG_FOLLOW_UP_DELAYS_MS = [3_000, 10_000, 30_000, 90_000, 240_000]

/** 连上客户端时读取的战绩条数，用来补录已有的排位对局 */
export const RANK_LOG_HISTORY_FULL_COUNT = 100

/** 每局结束后补读的战绩条数 */
export const RANK_LOG_HISTORY_RECENT_COUNT = 20

/** 结束后一直没等到胜点变化的对局（多半是重开）在待认领名单里保留多久 */
export const RANK_LOG_TRACKED_GAME_TTL_MS = 6 * 60 * 60_000

/** The account a log belongs to. */
export interface RankLogOwner {
  puuid: string
  sgpServerId: string
}

export interface RankLogMainContext {
  namespace: string
  logger: AkariLogger
  ipc: AkariIpcMain
  mobxUtils: MobxUtilsMain
  leagueClient: LeagueClientMain
  sgp: SgpMain
  storage: StorageMain
  settings: RankLogSettings
  state: RankLogState
}
