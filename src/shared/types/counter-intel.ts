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
  /** 当前筛选补丁；null 表示 OP.GG 最新补丁。 */
  version: string | null
  /** 用户主动刷新时绕过 8 分钟缓存。 */
  force?: boolean
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
  /** 本次胜率与单杀率共同绑定的补丁。 */
  version: string | null
  /** JSON 实际补丁，网页单杀率必须与其一致。 */
  sourceVersion?: string | null
  updatedAt: string
  /** 单杀率通道整体是否可用（网页改版导致全部解析失败时为 false） */
  laneKillAvailable: boolean
  rows: CounterIntelRow[]
}

/** 英雄 id → 分路 → 出场占比（0~1），用于全队分路指派推断 */
export type RolePriors = Record<number, Partial<Record<LaneName, number>>>

/* ================= [lolps] Bz 对线攻略 ================= */

export interface BzGuideParams {
  /** 敌方对位英雄 id */
  opponentChampionId: number
  /** 是否解析核心装备；纯文字消费者同时关闭 includeImages 才跳过资源库请求。 */
  includeCoreItems?: boolean
  /** false 仅取 CSV 文字；默认同时读取在线图片。 */
  includeImages?: boolean
  force?: boolean
}

export type BzImageIssueCode =
  | 'source-unavailable'
  | 'unknown-image'
  | 'ambiguous-position'
  | 'overlapping-images'
  | 'missing-spells'
  | 'missing-starter'
  | 'ambiguous-spells'
  | 'ambiguous-starter'
  | 'catalog-unavailable'
  | 'unavailable-in-patch'

export interface BzImageIssue {
  code: BzImageIssueCode
  field: 'spells' | 'starter' | 'both'
}

/** 同一份在线工作簿中的图片识别结果；缺失/冲突字段不生成推荐。 */
export interface BzImageLoadout {
  status: 'ready' | 'partial' | 'unavailable'
  spellIds?: [number, number]
  starterItemId?: number
  /** 已核对这些 id 的 Data Dragon 补丁。 */
  catalogVersion?: string
  /** 内容摘要覆盖图像及其实际位置，不能用导出时会变化的 imageN 文件名。 */
  fingerprint?: string
  issues: BzImageIssue[]
  /** 经解码验证并缩小的源图预览，供查看未知/冲突图标；禁止外部 URL。 */
  previews?: string[]
}

export interface BzMatchupRow {
  /** 表内英雄英文名（原文） */
  champion: string
  rune: string
  difficulty: string
  coreBuild: string
  summary: string
  sourceFormat?: 'xlsx' | 'csv'
  sourceSheet?: string
  sourceRow?: number
  imageLoadout?: BzImageLoadout
  /** 自动展示的已识别记录；仅供阅读，不能参与构筑或自动写入。 */
  imageReference?: {
    loadout: BzImageLoadout
    fetchedAt: number
    sourceSheet?: string
    sourceRow?: number
    reason: 'refreshing' | 'source-unavailable' | 'catalog-unavailable'
  }
  /** 后台正在刷新工作簿；完成后通过 bz-guide-updated 事件通知消费者。 */
  refreshing?: boolean
  /** 成功读取表格的时间；不是作者最后编辑时间。 */
  fetchedAt?: number
  stale?: boolean
  itemCatalogStale?: boolean
  unresolvedItems?: string[]
  /** 兼容旧消费者：单条核心装方案 */
  coreItemIds?: number[]
  /** 核心装的并列方案（例如「星蚀/亵渎九头蛇 → ...」） */
  coreItemBuilds?: number[][]
  /** Bz 推荐基石 perkId；无法识别为 null */
  keystonePerkId: number | null
}

export type BzGuideUnavailableReason =
  'invalid-opponent' | 'slug-unavailable' | 'source-unavailable' | 'not-found'

export interface BzGuideResult {
  found: boolean
  row: BzMatchupRow | null
  reason?: BzGuideUnavailableReason
}

/* ================= [lolps] 对位构筑（Matchup Build v3） ================= */

export interface MatchupBuildParams {
  /** 我的英雄 id */
  myChampionId: number
  /** 对位（敌方）英雄 id */
  opponentChampionId: number
  position: LaneName
  region: string
  tier: string | number
  /** 当前筛选补丁；null 表示 OP.GG 最新补丁。 */
  version: string | null
  /** 手动刷新时绕过 10 分钟缓存。 */
  force?: boolean
}

export interface MatchupBuildResult {
  myChampionId: number
  opponentChampionId: number
  position: LaneName
  region: string
  tier: string | number
  /** 请求绑定的补丁；用于渲染层拒绝异步旧结果。 */
  version: string | null
  /** OP.GG 实际返回的补丁；指定历史版本时必须与请求一致。 */
  sourceVersion: string | null
  /** 对位元信息（官方接口 counters 字段：play=对局数, win=我的胜场） */
  meta: { play: number; win: number } | null
  /**
   * 官方形状 data 子集（键名与 OP.GG 官方接口一致：
   * runes / summoner_spells / skill_masteries / starter_items / boots /
   * core_items / last_items）。缺失区块显式为空数组，避免通用数据混入。
   */
  overlay: Record<string, unknown> | null
  /** 有真实对位样本的区块键名（真机排障用） */
  parsedSections: string[]
  /** 已通过英雄、补丁和样本规模校验；false 时 overlay 必为 null。 */
  targetVerified: boolean
  updatedAt: string
}
