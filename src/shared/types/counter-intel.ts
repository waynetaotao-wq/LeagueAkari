import type { LaneName } from '@shared/utils/lane-assignment'

// 对位克制助手（Counter Intel）主进程 ↔ 渲染端共享类型

export interface CounterIntelParams {
  /** 敌方对位英雄 id */
  championId: number
  /** 我方分路（统一命名） */
  position: LaneName
  /** OP.GG 区服（'global' | 'kr' | ...） */
  region: string
  /** OP.GG 段位筛选（'all' | 'emerald_plus' | ... 或数字） */
  tier: string | number
}

export interface CounterIntelRow {
  /** 我方候选英雄 id */
  championId: number
  /** 该对位的样本场次 */
  games: number
  /** 候选英雄打「对位英雄」的胜率（0~1） */
  myWinRate: number
  /** 候选英雄单杀「对位英雄」的比率（0~1）；抓取失败为 null */
  laneKillRate: number | null
  /** 「对位英雄」单杀候选英雄的比率（0~1）；抓取失败为 null */
  enemyLaneKillRate: number | null
}

export interface CounterIntelResult {
  championId: number
  position: LaneName
  region: string
  tier: string | number
  updatedAt: string
  /** 单杀率通道整体是否可用（网页改版导致全部解析失败时为 false） */
  laneKillAvailable: boolean
  rows: CounterIntelRow[]
}

/** 英雄 id → 分路 → 出场占比（0~1），用于全队分路指派推断 */
export type RolePriors = Record<number, Partial<Record<LaneName, number>>>

/* ================= [lolps] 对位构筑（Matchup Build v2） ================= */

export interface MatchupBuildParams {
  /** 我的英雄 id */
  myChampionId: number
  /** 对位（敌方）英雄 id */
  opponentChampionId: number
  position: LaneName
  region: string
  tier: string | number
}

export interface MatchupBuildResult {
  myChampionId: number
  opponentChampionId: number
  position: LaneName
  region: string
  tier: string | number
  /** 对位元信息（官方接口 counters 字段：play=对局数, win=我的胜场） */
  meta: { play: number; win: number } | null
  /**
   * 官方形状 data 子集（键名与 OP.GG 官方接口一致：
   * runes / summoner_spells / starter_items / boots / core_items / last_items），
   * 渲染层直接 merge 进当前英雄数据实现整窗替换；解析全败为 null
   */
  overlay: Record<string, unknown> | null
  /** 解析成功的区块键名（真机排障用） */
  parsedSections: string[]
  pageParsed: boolean
  updatedAt: string
}
