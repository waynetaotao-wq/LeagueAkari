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

/* ================= [lolps] 对位构筑（Matchup Build） ================= */

export interface MatchupBuildParams {
  /** 我的英雄 id */
  myChampionId: number
  /** 对位（敌方）英雄 id */
  opponentChampionId: number
  position: LaneName
  region: string
  tier: string | number
}

/** 一条装备/召唤师技能构筑条目（图标 URL 驱动，尽量不依赖字段名细节） */
export interface MatchupBuildEntry {
  /** 该条目的图标序列（装备 1~3 件 / 召唤师技能 2 个），OP.GG CDN 直链 */
  imageUrls: string[]
  /** 从图标 URL 提取出的装备 id（召唤师技能条目为空数组） */
  itemIds: number[]
  /** 样本场次 */
  play: number | null
  /** 胜场 */
  win: number | null
  /** 选取率（0~1 或 0~100，按原样透传，组件自适应） */
  pickRate: number | null
  /** 胜率（同上） */
  winRate: number | null
}

export interface MatchupBuildSection {
  key: 'spells' | 'starter' | 'boots' | 'core' | 'item4' | 'item5'
  entries: MatchupBuildEntry[]
}

/** 一套符文页（原样透传 + 图标序列提炼） */
export interface MatchupRunePage {
  /** 主系样式名（如 Sorcery），解析不到为 null */
  styleName: string | null
  play: number | null
  pickRate: number | null
  /** 该 build 对象里出现的全部符文/系别图标 URL（按出现顺序） */
  imageUrls: string[]
  /** 结构化符文 id（一键置入用）；主4副2碎3齐全才非 null */
  structured: {
    primaryStyleId: number
    secondaryStyleId: number
    primaryRuneIds: number[]
    secondaryRuneIds: number[]
    statShardIds: number[]
  } | null
  /** 原样 JSON（真机字段校正用；组件不直接依赖） */
  raw: unknown
}

export interface MatchupBuildResult {
  myChampionId: number
  opponentChampionId: number
  position: LaneName
  region: string
  tier: string | number
  /** 对位元信息：来自官方接口 counters 字段（play=对局数, win=胜场） */
  meta: { play: number; win: number } | null
  runePages: MatchupRunePage[]
  sections: MatchupBuildSection[]
  /** 网页解析整体是否成功（false 时 sections/runePages 可能为空） */
  pageParsed: boolean
  updatedAt: string
}
