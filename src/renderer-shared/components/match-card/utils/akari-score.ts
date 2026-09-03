/**
 * [lolps] 对局评分（每局每人 0–10，OP.GG OP Score 同类思路；界面名"对局评分"，
 * 与官方绝对量表 `computeSingleAkariScore`（"Akari Score"）无关，文件名沿用历史）。
 *
 * 设计原则（手册 §10.26 / §10.27）：
 * 1. 归一化：每项换成"占队伍份额"或"每分钟"，再除以本局期望 → 比率 r（1.0 = 本局平均）
 * 2. 分路加权：五个位置各一组权重；位置未知用通用配置（打野/辅助可由数据推断）
 * 3. 局内相对：只在本局 10 人内比较，不受版本 / 段位 / 模式影响
 * 4. 数据源未提供的项自动剔除并把权重归一到其余项（LCU 摘要缺字段时优雅退化）
 * 5. 映射：composite（≈1.0 平均）→ 5 + 5·tanh(α·(c−1))，压到 0–10
 *
 * 全部离线计算，只读战绩摘要，不接触任何外部服务。
 */

export type AkariScorePosition = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | 'UNKNOWN'

export interface AkariScoreInput {
  puuid: string
  teamIdentifier: string
  position: string | null
  win: boolean
  kills: number
  deaths: number
  assists: number
  totalDamageDealtToChampions: number
  totalDamageTaken: number
  goldEarned: number
  cs: number
  neutralMinionsKilled: number
  visionScore: number
  timeCCingOthers: number
  totalDamageToTowers: number
  soloKills: number | null
  doubleKills: number
  tripleKills: number
  quadraKills: number
  pentaKills: number

  // ---- v2 扩展（SGP 摘要有；LCU 摘要部分缺失，缺失即不参与）----
  /** 免伤量：坦克真正挡下的伤害 */
  damageSelfMitigated?: number | null
  /** 本局坐牢总秒数：比"死亡次数"更能反映死亡代价 */
  totalTimeSpentDead?: number | null
  /** 给队友的治疗 + 护盾（辅助/坦克的支援贡献） */
  healsOnTeammates?: number | null
  shieldsOnTeammates?: number | null
  /** 有效治疗与护盾（挑战数据；给队友数据缺失时兜底） */
  effectiveHealAndShielding?: number | null
  /** 对目标伤害：建筑 + 史诗野怪 */
  damageDealtToObjectives?: number | null
  /** 龙 / 男爵 / 峡谷先锋参与击杀次数之和 */
  epicTakedowns?: number | null
  /** 对线补刀最大领先（可为负）与最大等级领先 */
  maxCsAdvantageOnLaneOpponent?: number | null
  maxLevelLeadLaneOpponent?: number | null
  /** 视野质量：控制守卫 + 排眼 */
  controlWardsPlaced?: number | null
  wardTakedowns?: number | null
  /** 控制质量：定身敌方英雄次数 */
  immobilizations?: number | null
  /** 推进压制：镀层 + 参与推塔 */
  turretPlatesTaken?: number | null
  turretTakedowns?: number | null
  /** 抢龙 / 抢男爵等偷取次数（加成项） */
  objectiveSteals?: number | null
  /** 本局有队友挂机（仅标注，不入分） */
  hadAfkTeammate?: boolean | null
  /** 本局以投降结束（用于碾压局判定） */
  gameEndedInSurrender?: boolean | null
  /** 成就用：一血、最大连杀 */
  firstBloodKill?: boolean | null
  largestKillingSpree?: number | null
}

export type AkariMetricKey =
  | 'damage'
  | 'tank'
  | 'support'
  | 'kp'
  | 'survival'
  | 'gold'
  | 'cs'
  | 'vision'
  | 'cc'
  | 'objective'
  | 'lane'
  | 'efficiency'

export interface AkariScore {
  puuid: string
  rating: number
  /** 各指标比率（1.0 = 本局期望），用于悬浮拆解；缺数据的项不出现 */
  metrics: Partial<Record<AkariMetricKey, number>>
  position: AkariScorePosition
  isMvp: boolean
  isSvp: boolean
  /** 输了但表现在阈值之上（= tag === 'effort'） */
  isCarryLoss: boolean
  /** 本局有队友挂机（语境标注） */
  afkTeammate: boolean
  /** 荣誉徽标：MVP / SVP */
  badge: 'MVP' | 'SVP' | null
  /** 对局标签（WeGame 式，规则见 assignGameTags） */
  tag: AkariGameTag | null
}

/** 本局某玩家的相对指标样本（校准拟合与评分共用） */
export interface AkariMetricSample {
  puuid: string
  teamIdentifier: string
  position: AkariScorePosition
  /** 峡谷 / 大乱斗（决定用分路权重还是大乱斗权重） */
  mode: AkariScoreMode
  win: boolean
  metrics: Partial<Record<AkariMetricKey, number>>
  bonus: number
  afkTeammate: boolean
  kills: number
  surrender: boolean
  gold: number
  turretTakedowns: number
}

export type AkariPositionWeights = Record<AkariScorePosition, Record<AkariMetricKey, number>>

/**
 * 评分口径（四条路各走各的，由 resolveAkariScoreMode 统一分流）：
 *  - sr：召唤师峡谷（分路推断 + 分路权重 + 位置基线 + 对位比较）
 *  - aram：极地大乱斗（不推断位置，大乱斗权重）
 *  - mayhem：海克斯/符文大乱斗（gameMode = KIWI；不推断位置，海克斯专用权重）
 *  - other：其它两队模式（极限闪击、克隆、无限火力等；不推断位置，用大乱斗权重兜底）
 */
export type AkariScoreMode = 'sr' | 'aram' | 'mayhem' | 'other'

/** 由战绩基本信息判定口径；斗魂竞技场（CHERRY，四队）返回 null = 不评分 */
export function resolveAkariScoreMode(info: {
  gameMode: string | null | undefined
  mapId?: number | null
}): AkariScoreMode | null {
  const gameMode = String(info.gameMode ?? '').toUpperCase()
  if (gameMode === 'CHERRY') return null
  if (gameMode === 'KIWI') return 'mayhem'
  if (gameMode === 'ARAM') return 'aram'
  if (gameMode === 'CLASSIC') return 'sr'
  // 训练模式 / 无限火力 / 克隆等：在召唤师峡谷（mapId 11）上打的按峡谷口径，否则按通用口径
  if (info.mapId === 11) return 'sr'
  return 'other'
}

export const AKARI_SCORE_MODE_LABELS: Record<AkariScoreMode, string> = {
  sr: '召唤师峡谷',
  aram: '极地大乱斗',
  mayhem: '海克斯大乱斗',
  other: '其它模式'
}

/**
 * 大乱斗专用权重（可调区）：没有分路与对线，补刀 / 视野 / 对线几乎不构成差异，
 * 团战输出、参团、生存、坦度与支援才是主体。
 */
export const AKARI_ARAM_WEIGHTS: Record<AkariMetricKey, number> = {
  damage: 0.26, tank: 0.13, support: 0.08, kp: 0.17, survival: 0.15, gold: 0.05,
  cs: 0.01, vision: 0.01, cc: 0.07, objective: 0.04, lane: 0, efficiency: 0.03
}

/**
 * 海克斯大乱斗专用权重（可调区）：强化会把伤害/治疗成倍放大，因此伤害与支援的权重
 * 相对普通大乱斗压低，参团与生存抬高；补刀/视野/对线不计。
 */
export const AKARI_MAYHEM_WEIGHTS: Record<AkariMetricKey, number> = {
  damage: 0.22, tank: 0.14, support: 0.07, kp: 0.21, survival: 0.18, gold: 0.04,
  cs: 0, vision: 0, cc: 0.08, objective: 0.04, lane: 0, efficiency: 0.02
}

/** 各口径的权重表入口：sr 走分路权重（含校准覆盖），其余各用自己的固定表 */
export function weightsForSample(
  sample: { mode: AkariScoreMode; position: AkariScorePosition },
  weightsTable = getAkariPositionWeights()
): Record<AkariMetricKey, number> {
  switch (sample.mode) {
    case 'aram':
      return AKARI_ARAM_WEIGHTS
    case 'mayhem':
      return AKARI_MAYHEM_WEIGHTS
    case 'other':
      return AKARI_ARAM_WEIGHTS
    default:
      return weightsTable[sample.position] ?? AKARI_POSITION_WEIGHTS.UNKNOWN
  }
}

// 权重覆盖（由"用我的战绩校准"写入；null = 使用内置先验）
let activeWeightsOverride: AkariPositionWeights | null = null
export function setAkariPositionWeights(weights: AkariPositionWeights | null) {
  activeWeightsOverride = weights
}
export function getAkariPositionWeights(): AkariPositionWeights {
  return activeWeightsOverride ?? AKARI_POSITION_WEIGHTS
}

export interface AkariScoreResult {
  byPuuid: Map<string, AkariScore>
  mvpPuuid: string | null
  svpPuuid: string | null
  /** 提前投降（重开）局：不评分 */
  skipped: 'early-surrender' | null
}

/** 映射曲线陡峭度：c=1.35 → ≈8.5，c=1.6 → ≈9.5，c=0.7 → ≈1.8，c=1.05 → ≈5.6 */
export const AKARI_SCORE_ALPHA = 2.5
/** 单项比率上限：防止极端值（如 0 死亡 / 唯一治疗者）压过其它维度 */
export const AKARI_METRIC_CAP = 2.5
/**
 * 显示量表（可调区）：内部计算恒为 0–10（5.0 = 本局平均水平）。
 * 界面按 WeGame 式分布换算：平均 → 7.5，内部满分 10 → 17.4（几乎打不出来），
 * 碾压全场的 MVP 通常落在 13–15，崩盘局 3–5。颜色档位与 MVP/SVP 判定不受量表影响。
 */
export const AKARI_RATING_DISPLAY_MAX = 17.4
export const AKARI_RATING_DISPLAY_CENTER = 7.5
const DISPLAY_SLOPE = (AKARI_RATING_DISPLAY_MAX - AKARI_RATING_DISPLAY_CENTER) / 5

export function toDisplayRating(rating: number): number {
  return clamp(AKARI_RATING_DISPLAY_CENTER + (rating - 5) * DISPLAY_SLOPE, 0, AKARI_RATING_DISPLAY_MAX)
}
export function fromDisplayRating(display: number): number {
  return 5 + (display - AKARI_RATING_DISPLAY_CENTER) / DISPLAY_SLOPE
}
/** 内部 0–10 评分 → 显示量表字符串（一位小数） */
export function formatAkariRating(rating: number): string {
  return toDisplayRating(rating).toFixed(1)
}

/** 标签阈值（按显示量表定义，便于对照 WeGame 手感；可调区） */
export const AKARI_TAG_THRESHOLDS = {
  /** 输了但表现 ≥ 此分 → 尽力局 */
  effortMin: 10.0,
  /** 赢了且 ≥ 此分并明显高于队友 → carry 局（11.0 ≈ 比本局平均高 18%） */
  carryMin: 11.0,
  /** carry 局：需领先队内第三高至少此内部分差（1.25 内部 ≈ 2.5 显示分；允许双 carry 同时成立） */
  carryLeadInternal: 1.25,
  /** 赢了但 ≤ 此分且明显低于队友 → 躺赢局 */
  lyingMax: 6.0,
  /** 输了且 ≤ 此分、全队最低且明显低于队友 → 甩锅局 */
  blameMax: 5.0,
  /** 躺赢/甩锅：需低于队友均值至少此内部分差 */
  belowTeamInternal: 1.0,
  /**
   * 碾压局（队伍层面），满足其一：
   *  a) 队伍经济比 ≥ stompGoldRatio（最硬的信号，不依赖投降与时长）
   *  b) 己方 ≥ 15 杀且击杀比 ≥ stompKillRatio
   *  c) 对方投降且时长 ≤ stompMaxMinutes 且经济比 ≥ stompSurrenderGoldRatio（排除崩盘前的胶着局）
   */
  stompGoldRatio: 1.25,
  stompKillRatio: 2.0,
  stompMaxMinutes: 25,
  stompSurrenderGoldRatio: 1.12,
  /** 甩锅局额外条件：队友均值（内部分）≥ 此值——整队崩盘时不给任何人扣甩锅帽子 */
  blameTeammatesMinInternal: 4.5
} as const
/** 尽力局阈值（内部 0–10 量表，由显示阈值换算而来） */
export const AKARI_CARRY_LOSS_THRESHOLD = fromDisplayRating(AKARI_TAG_THRESHOLDS.effortMin)

export type AkariGameTag = 'carry' | 'lying' | 'stomp' | 'effort' | 'blame' | 'afk'
export const AKARI_GAME_TAG_LABELS: Record<AkariGameTag, string> = {
  carry: 'Carry 局',
  lying: '躺赢局',
  stomp: '碾压局',
  effort: '尽力局',
  blame: '甩锅局',
  afk: '挂机局'
}

export const AKARI_METRIC_LABELS: Record<AkariMetricKey, string> = {
  damage: '输出',
  tank: '坦度',
  support: '支援',
  kp: '参团',
  survival: '生存',
  gold: '经济',
  cs: '补刀',
  vision: '视野',
  cc: '控制',
  objective: '目标',
  lane: '对线',
  efficiency: '效率'
}

/** 分路权重（可调区；代码内自动归一化，改动无需手工配平） */
export const AKARI_POSITION_WEIGHTS: Record<AkariScorePosition, Record<AkariMetricKey, number>> = {
  TOP: {
    damage: 0.18, tank: 0.16, support: 0.02, kp: 0.09, survival: 0.14, gold: 0.1,
    cs: 0.08, vision: 0.03, cc: 0.05, objective: 0.06, lane: 0.06, efficiency: 0.03
  },
  JUNGLE: {
    damage: 0.13, tank: 0.1, support: 0.02, kp: 0.2, survival: 0.13, gold: 0.09,
    cs: 0.05, vision: 0.07, cc: 0.05, objective: 0.12, lane: 0, efficiency: 0.04
  },
  MIDDLE: {
    damage: 0.22, tank: 0.03, support: 0.02, kp: 0.14, survival: 0.14, gold: 0.11,
    cs: 0.1, vision: 0.04, cc: 0.05, objective: 0.05, lane: 0.07, efficiency: 0.03
  },
  BOTTOM: {
    damage: 0.24, tank: 0.02, support: 0.02, kp: 0.11, survival: 0.14, gold: 0.12,
    cs: 0.11, vision: 0.03, cc: 0.02, objective: 0.08, lane: 0.07, efficiency: 0.04
  },
  UTILITY: {
    damage: 0.07, tank: 0.1, support: 0.18, kp: 0.2, survival: 0.12, gold: 0.03,
    cs: 0.01, vision: 0.16, cc: 0.11, objective: 0.02, lane: 0, efficiency: 0
  },
  UNKNOWN: {
    damage: 0.18, tank: 0.09, support: 0.05, kp: 0.14, survival: 0.14, gold: 0.1,
    cs: 0.08, vision: 0.06, cc: 0.05, objective: 0.06, lane: 0.03, efficiency: 0.02
  }
}

/**
 * 位置基线（可调区）：各位置在一局里的典型份额 / 相对全场均值的典型倍率。
 * 份额类（damage/tank/support/objective 的队伍份额）为绝对份额（五人之和≈1）；
 * 倍率类（kp/vision/cc）为相对全场均值的倍数（五位置均值≈1）。
 * 与"同位置对手均值"各取一半构成期望，既消除位置红利，也不因对手过菜而虚高。
 */
export const AKARI_POSITION_BASELINES: Record<
  Exclude<AkariScorePosition, 'UNKNOWN'>,
  { dmgShare: number; tankShare: number; supportShare: number; objectiveShare: number; kp: number; vision: number; cc: number }
> = {
  TOP: { dmgShare: 0.2, tankShare: 0.27, supportShare: 0.1, objectiveShare: 0.22, kp: 0.75, vision: 0.7, cc: 1.15 },
  JUNGLE: { dmgShare: 0.17, tankShare: 0.22, supportShare: 0.1, objectiveShare: 0.25, kp: 1.15, vision: 1.0, cc: 1.0 },
  MIDDLE: { dmgShare: 0.24, tankShare: 0.17, supportShare: 0.08, objectiveShare: 0.18, kp: 0.95, vision: 0.7, cc: 0.8 },
  BOTTOM: { dmgShare: 0.27, tankShare: 0.15, supportShare: 0.07, objectiveShare: 0.25, kp: 1.0, vision: 0.65, cc: 0.45 },
  UTILITY: { dmgShare: 0.12, tankShare: 0.19, supportShare: 0.65, objectiveShare: 0.1, kp: 1.35, vision: 2.4, cc: 1.7 }
}

const METRIC_KEYS: AkariMetricKey[] = [
  'damage', 'tank', 'support', 'kp', 'survival', 'gold',
  'cs', 'vision', 'cc', 'objective', 'lane', 'efficiency'
]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function has(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

/** 位置归一：SGP 的 teamPosition（TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY）；其它写法尽量映射 */
export function normalizePosition(position: string | null | undefined): AkariScorePosition {
  const p = (position ?? '').toUpperCase()
  if (p === 'TOP') return 'TOP'
  if (p === 'JUNGLE' || p === 'JG') return 'JUNGLE'
  if (p === 'MIDDLE' || p === 'MID') return 'MIDDLE'
  if (p === 'BOTTOM' || p === 'BOT' || p === 'ADC') return 'BOTTOM'
  if (p === 'UTILITY' || p === 'SUPPORT' || p === 'SUP') return 'UTILITY'
  return 'UNKNOWN'
}

/**
 * 位置缺失（LCU 摘要）时的推断：每队野怪击杀最多者为打野，其余中补刀最少且视野最高者为辅助；
 * 剩下三人无法区分上/中/下，统一用通用权重。
 */
function inferPositions(team: AkariScoreInput[]): Map<string, AkariScorePosition> {
  const out = new Map<string, AkariScorePosition>()
  const known = team.filter((p) => normalizePosition(p.position) !== 'UNKNOWN')
  if (team.length !== 5 || known.length === team.length) {
    for (const p of team) out.set(p.puuid, normalizePosition(p.position))
    return out
  }
  const byJungle = [...team].sort((a, b) => b.neutralMinionsKilled - a.neutralMinionsKilled)
  const jungle = byJungle[0].neutralMinionsKilled >= 20 ? byJungle[0] : null
  const rest = team.filter((p) => p !== jungle)
  const support = [...rest].sort((a, b) => a.cs - b.cs || b.visionScore - a.visionScore)[0]
  for (const p of team) {
    if (p === jungle) out.set(p.puuid, 'JUNGLE')
    else if (p === support) out.set(p.puuid, 'UTILITY')
    else out.set(p.puuid, 'UNKNOWN')
  }
  return out
}

interface Derived {
  puuid: string
  teamIdentifier: string
  win: boolean
  position: AkariScorePosition
  size: number
  dmgShare: number
  tankShare: number
  supportShare: number | null
  objectiveDmgShare: number | null
  epicShare: number | null
  kp: number
  deathShare: number
  timeDeadShare: number | null
  gpm: number
  cspm: number
  vspm: number
  ccpm: number
  efficiency: number | null
  lane: number | null
  visionQualityPm: number | null
  immobPm: number | null
  pressureShare: number | null
  bonus: number
  afkTeammate: boolean
  kills: number
  surrender: boolean
  gold: number
  turretTakedowns: number
}

/**
 * 计算本局全部参与者的相对指标样本（1.0 = 本局期望）。评分与权重校准共用这一步。
 * 仅对两队有意义；参与者不足 2 人、时长为 0 或提前投降局返回空数组。
 */
/**
 * 默认口径（2026-09-03 用 4 局顶尖对局对照 OP.GG 校准：排名一致性 0.53 → 0.855，MVP 4/4）：
 * 份额按全场计、对位均值占 25%。
 */
export const AKARI_DEFAULT_SHARE_SCOPE: 'game' | 'team' = 'game'
export const AKARI_DEFAULT_PAIR_BLEND = 0.25

export interface AkariMetricOptions {
  earlySurrender?: boolean
  mode?: AkariScoreMode
  /**
   * 份额口径：'game' = 占全场份额（输方打得少份额自然低，胜负效应来自真实表现；默认），
   * 'team' = 占本队份额（旧口径，输方账面与赢方一样好看）
   */
  shareScope?: 'game' | 'team'
  /** 输出/坦度/支援/参团/目标等指标里"同位置对手均值"所占比例（0 = 只用位置基线；默认 0.25） */
  pairBlend?: number
}

export function computeAkariMetrics(
  participants: AkariScoreInput[],
  gameDurationSeconds: number,
  options: AkariMetricOptions = {}
): AkariMetricSample[] {
  if (options.earlySurrender) return []
  const mode: AkariScoreMode = options.mode ?? 'sr'
  const shareScope = options.shareScope ?? AKARI_DEFAULT_SHARE_SCOPE
  const pairBlend = options.pairBlend ?? AKARI_DEFAULT_PAIR_BLEND
  const minutes = num(gameDurationSeconds) / 60
  if (participants.length < 2 || minutes <= 0) return []

  const teams = new Map<string, AkariScoreInput[]>()
  for (const p of participants) {
    const list = teams.get(p.teamIdentifier) ?? []
    list.push(p)
    teams.set(p.teamIdentifier, list)
  }
  if (teams.size !== 2) return []

  // 大乱斗：没有分路，不做位置推断（否则补刀最少者会被误当成辅助套上辅助权重），全员 UNKNOWN
  const positionByPuuid = new Map<string, AkariScorePosition>()
  for (const team of teams.values()) {
    if (mode === 'sr') {
      for (const [puuid, position] of inferPositions(team)) positionByPuuid.set(puuid, position)
    } else {
      for (const p of team) positionByPuuid.set(p.puuid, 'UNKNOWN')
    }
  }

  // 全局可用性：某项原始数据整局缺失/全 0 → 该项不参与，权重归一到其余项
  const anyPresent = (pick: (p: AkariScoreInput) => number | null | undefined) =>
    participants.some((p) => {
      const v = pick(p)
      return has(v) && v !== 0
    })
  const supportViaTeammates = anyPresent((p) => num(p.healsOnTeammates) + num(p.shieldsOnTeammates))
  const supportViaEffective = !supportViaTeammates && anyPresent((p) => p.effectiveHealAndShielding)
  const supportAvailable = supportViaTeammates || supportViaEffective
  const objectiveViaObjectives = anyPresent((p) => p.damageDealtToObjectives)
  const objectiveViaTowers = !objectiveViaObjectives && anyPresent((p) => p.totalDamageToTowers)
  const objectiveAvailable = objectiveViaObjectives || objectiveViaTowers
  const epicAvailable = anyPresent((p) => p.epicTakedowns)
  const timeDeadAvailable = participants.some((p) => has(p.totalTimeSpentDead))
  const laneAvailable = participants.some(
    (p) => has(p.maxCsAdvantageOnLaneOpponent) || has(p.maxLevelLeadLaneOpponent)
  )
  const visionAvailable = anyPresent((p) => p.visionScore)
  const ccAvailable = anyPresent((p) => p.timeCCingOthers)
  const tankAvailable = anyPresent((p) => num(p.totalDamageTaken) + num(p.damageSelfMitigated))
  const efficiencyAvailable = anyPresent((p) => p.goldEarned)
  const visionQualityAvailable = anyPresent((p) => num(p.controlWardsPlaced) + num(p.wardTakedowns))
  const immobAvailable = anyPresent((p) => p.immobilizations)
  const pressureAvailable = anyPresent((p) => num(p.turretPlatesTaken) + num(p.turretTakedowns))

  // 全场总量（'game' 口径：每人份额 = 值 / (全场总量 / 队数)，全场平均仍为 1/size，
  // 但打得多的队整体 >1/size、打得少的队整体 <1/size——胜负效应来自真实表现，不是加分）
  const teamCount = teams.size
  const gsum = (pick: (p: AkariScoreInput) => number) => participants.reduce((s, p) => s + pick(p), 0)
  const gameKills = gsum((p) => num(p.kills))
  const gameDeaths = gsum((p) => num(p.deaths))
  const gameDmg = gsum((p) => num(p.totalDamageDealtToChampions))
  const gameSupport = supportViaTeammates
    ? gsum((p) => num(p.healsOnTeammates) + num(p.shieldsOnTeammates))
    : gsum((p) => num(p.effectiveHealAndShielding))
  const gameObjective = objectiveViaObjectives
    ? gsum((p) => num(p.damageDealtToObjectives))
    : gsum((p) => num(p.totalDamageToTowers))
  const gameEpic = gsum((p) => num(p.epicTakedowns))
  const gameTimeDead = gsum((p) => num(p.totalTimeSpentDead))
  const gamePressure = gsum((p) => num(p.turretPlatesTaken) + num(p.turretTakedowns))

  const derived: Derived[] = []
  for (const team of teams.values()) {
    const size = team.length
    const sum = (pick: (p: AkariScoreInput) => number) => team.reduce((s, p) => s + pick(p), 0)
    const teamKills = sum((p) => num(p.kills))
    const teamDeaths = sum((p) => num(p.deaths))
    const teamDmg = sum((p) => num(p.totalDamageDealtToChampions))
    const teamTank = sum((p) => num(p.totalDamageTaken) + num(p.damageSelfMitigated))
    const teamSupport = supportViaTeammates
      ? sum((p) => num(p.healsOnTeammates) + num(p.shieldsOnTeammates))
      : sum((p) => num(p.effectiveHealAndShielding))
    const teamObjective = objectiveViaObjectives
      ? sum((p) => num(p.damageDealtToObjectives))
      : sum((p) => num(p.totalDamageToTowers))
    const teamEpic = sum((p) => num(p.epicTakedowns))
    const teamTimeDead = sum((p) => num(p.totalTimeSpentDead))
    const teamPressure = sum((p) => num(p.turretPlatesTaken) + num(p.turretTakedowns))
    const share = (value: number, total: number) => (total > 0 ? value / total : 1 / size)
    /** 按口径选择分母：全场总量/队数 或 本队总量 */
    const scoped = (value: number, teamTotal: number, gameTotal: number) =>
      shareScope === 'game' ? share(value, gameTotal / teamCount) : share(value, teamTotal)

    for (const p of team) {
      const kills = num(p.kills)
      const deaths = num(p.deaths)
      const assists = num(p.assists)
      const gold = num(p.goldEarned)
      const multi =
        num(p.doubleKills) * 0.03 +
        num(p.tripleKills) * 0.06 +
        num(p.quadraKills) * 0.1 +
        num(p.pentaKills) * 0.15
      const solo = clamp(num(p.soloKills), 0, 5) * 0.02
      const steals = clamp(num(p.objectiveSteals) * 0.05, 0, 0.1)
      const supportValue = supportViaTeammates
        ? num(p.healsOnTeammates) + num(p.shieldsOnTeammates)
        : num(p.effectiveHealAndShielding)
      const objectiveValue = objectiveViaObjectives
        ? num(p.damageDealtToObjectives)
        : num(p.totalDamageToTowers)
      let lane: number | null = null
      if (laneAvailable && (has(p.maxCsAdvantageOnLaneOpponent) || has(p.maxLevelLeadLaneOpponent))) {
        lane =
          1 +
          clamp(num(p.maxCsAdvantageOnLaneOpponent) / 40, -0.6, 0.6) +
          clamp(num(p.maxLevelLeadLaneOpponent) / 4, -0.3, 0.3)
      }
      derived.push({
        puuid: p.puuid,
        teamIdentifier: p.teamIdentifier,
        win: p.win,
        position: positionByPuuid.get(p.puuid) ?? 'UNKNOWN',
        size,
        dmgShare: scoped(num(p.totalDamageDealtToChampions), teamDmg, gameDmg),
        // 坦度保持本队口径：输方被动承伤天然更多，按全场算会奖励送死
        tankShare: share(num(p.totalDamageTaken) + num(p.damageSelfMitigated), teamTank),
        supportShare: supportAvailable ? scoped(supportValue, teamSupport, gameSupport) : null,
        objectiveDmgShare: objectiveAvailable
          ? scoped(objectiveValue, teamObjective, gameObjective)
          : null,
        epicShare: epicAvailable
          ? shareScope === 'game'
            ? gameEpic > 0
              ? num(p.epicTakedowns) / (gameEpic / teamCount)
              : null
            : teamEpic > 0
              ? num(p.epicTakedowns) / teamEpic
              : null
          : null,
        // 参团：'game' 口径 = 参与击杀数 / (全场击杀/队数)，赢方整体高于输方
        kp:
          shareScope === 'game'
            ? gameKills > 0
              ? (kills + assists) / (gameKills / teamCount)
              : 0
            : teamKills > 0
              ? (kills + assists) / teamKills
              : 0,
        // 死亡：'game' 口径 = 死亡 / (全场死亡/队数)，输方死得多整体份额高 → 生存低
        deathShare:
          shareScope === 'game'
            ? gameDeaths > 0
              ? deaths / (gameDeaths / teamCount)
              : 0
            : teamDeaths > 0
              ? deaths / teamDeaths
              : 0,
        timeDeadShare: timeDeadAvailable
          ? shareScope === 'game'
            ? gameTimeDead > 0
              ? num(p.totalTimeSpentDead) / (gameTimeDead / teamCount)
              : null
            : teamTimeDead > 0
              ? num(p.totalTimeSpentDead) / teamTimeDead
              : null
          : null,
        gpm: gold / minutes,
        cspm: num(p.cs) / minutes,
        vspm: num(p.visionScore) / minutes,
        ccpm: num(p.timeCCingOthers) / minutes,
        efficiency: gold > 0 ? num(p.totalDamageDealtToChampions) / gold : null,
        lane,
        visionQualityPm: visionQualityAvailable
          ? (num(p.controlWardsPlaced) + num(p.wardTakedowns)) / minutes
          : null,
        immobPm: immobAvailable ? num(p.immobilizations) / minutes : null,
        pressureShare: pressureAvailable
          ? shareScope === 'game'
            ? gamePressure > 0
              ? (num(p.turretPlatesTaken) + num(p.turretTakedowns)) / (gamePressure / teamCount)
              : null
            : teamPressure > 0
              ? (num(p.turretPlatesTaken) + num(p.turretTakedowns)) / teamPressure
              : null
          : null,
        bonus: clamp(multi + solo + steals, 0, 0.35),
        afkTeammate: p.hadAfkTeammate === true,
        kills,
        surrender: p.gameEndedInSurrender === true,
        gold,
        turretTakedowns: num(p.turretTakedowns)
      })
    }
  }

  const gameMean = {
    kp: mean(derived.map((d) => d.kp)),
    gpm: mean(derived.map((d) => d.gpm)),
    cspm: mean(derived.map((d) => d.cspm)),
    vspm: mean(derived.map((d) => d.vspm)),
    ccpm: mean(derived.map((d) => d.ccpm)),
    efficiency: mean(derived.map((d) => d.efficiency ?? 0)),
    visionQualityPm: mean(derived.map((d) => d.visionQualityPm ?? 0)),
    immobPm: mean(derived.map((d) => d.immobPm ?? 0))
  }
  const counterpart = (d: Derived) =>
    d.position === 'UNKNOWN'
      ? null
      : (derived.find((o) => o.teamIdentifier !== d.teamIdentifier && o.position === d.position) ??
        null)
  const ratio = (value: number, expected: number) =>
    expected > 0 ? clamp(value / expected, 0, AKARI_METRIC_CAP) : value > 0 ? AKARI_METRIC_CAP : 1
  const pairExpected = (d: Derived, pick: (x: Derived) => number, fallback: number) => {
    const c = counterpart(d)
    return c ? (pick(d) + pick(c)) / 2 : fallback
  }

  const samples: AkariMetricSample[] = []
  for (const d of derived) {
    const share = 1 / d.size
    // 位置归一（核心）：每项指标的期望都取"我与对面同位置者的均值"——辅助的参团/视野/控制/治疗、
    // 上单的承伤、AD 的伤害份额，天生就高或低，与全场均值比会产生巨大的位置红利/惩罚
    // （实测：平平无奇的一局辅助能拿 16.6）。同位置对手缺失（位置未知/双方阵容不对称）时退回全场口径。
    const baseline = d.position === 'UNKNOWN' ? null : AKARI_POSITION_BASELINES[d.position]
    /**
     * 期望 = 同位置对手均值 与 位置基线期望 各半；缺对手时只用基线；位置未知时退回全场口径。
     * @param pick 取值函数（对位均值用）
     * @param baselineExpected 该位置的基线期望（份额或 倍率×全场均值）
     * @param fallback 位置未知时的期望
     */
    const exp = (pick: (x: Derived) => number, baselineExpected: number | null, fallback: number) => {
      const c = counterpart(d)
      const pair = c ? (pick(d) + pick(c)) / 2 : null
      if (pair !== null && baselineExpected !== null) {
        return pairBlend * pair + (1 - pairBlend) * baselineExpected
      }
      if (baselineExpected !== null) return baselineExpected
      return pair ?? fallback
    }
    const metrics: Partial<Record<AkariMetricKey, number>> = {}
    metrics.damage = ratio(d.dmgShare, exp((x) => x.dmgShare, baseline?.dmgShare ?? null, share))
    if (tankAvailable) {
      metrics.tank = ratio(d.tankShare, exp((x) => x.tankShare, baseline?.tankShare ?? null, share))
    }
    if (d.supportShare !== null) {
      metrics.support = ratio(
        d.supportShare,
        exp((x) => x.supportShare ?? 0, baseline?.supportShare ?? null, share)
      )
    }
    metrics.kp = ratio(d.kp, exp((x) => x.kp, baseline ? baseline.kp * gameMean.kp : null, gameMean.kp))
    // 生存：死亡份额与坐牢时长份额各半（无坐牢数据时只用死亡份额）；份额=平均 → 1.0，0 死 → 上限
    const deathBlend =
      d.timeDeadShare !== null ? 0.5 * d.deathShare + 0.5 * d.timeDeadShare : d.deathShare
    // 单人队伍（1v1 练习/自定义）时 1 − share = 0，避免 0/0 → NaN
    metrics.survival =
      1 - share > 0 ? clamp((1 - deathBlend) / (1 - share), 0, AKARI_METRIC_CAP) : 1
    // 经济 / 补刀：对线口径（只与同位置对手比；无对手时全场均值）
    metrics.gold = ratio(d.gpm, pairExpected(d, (x) => x.gpm, gameMean.gpm))
    metrics.cs = ratio(d.cspm, pairExpected(d, (x) => x.cspm, gameMean.cspm))
    if (visionAvailable) {
      // 视野 = 视野分 0.7 + 视野质量（控制守卫+排眼）0.3（有数据时）
      const vBase = baseline ? baseline.vision : null
      const scorePart = ratio(d.vspm, exp((x) => x.vspm, vBase !== null ? vBase * gameMean.vspm : null, gameMean.vspm))
      metrics.vision =
        d.visionQualityPm !== null
          ? 0.7 * scorePart +
            0.3 *
              ratio(
                d.visionQualityPm,
                exp(
                  (x) => x.visionQualityPm ?? 0,
                  vBase !== null ? vBase * gameMean.visionQualityPm : null,
                  gameMean.visionQualityPm
                )
              )
          : scorePart
    }
    if (ccAvailable) {
      // 控制 = 控制时长 0.6 + 定身次数 0.4（有数据时）
      const cBase = baseline ? baseline.cc : null
      const timePart = ratio(d.ccpm, exp((x) => x.ccpm, cBase !== null ? cBase * gameMean.ccpm : null, gameMean.ccpm))
      metrics.cc =
        d.immobPm !== null
          ? 0.6 * timePart +
            0.4 *
              ratio(
                d.immobPm,
                exp((x) => x.immobPm ?? 0, cBase !== null ? cBase * gameMean.immobPm : null, gameMean.immobPm)
              )
          : timePart
    }
    if (d.objectiveDmgShare !== null) {
      // 目标 = 对目标伤害 0.5 + 史诗野怪参与 0.3 + 推进压制（镀层/推塔）0.2，缺项按可用部分归一
      const oBase = baseline?.objectiveShare ?? null
      const parts: Array<[number, number]> = [
        [0.5, ratio(d.objectiveDmgShare, exp((x) => x.objectiveDmgShare ?? 0, oBase, share))]
      ]
      if (d.epicShare !== null) parts.push([0.3, ratio(d.epicShare, exp((x) => x.epicShare ?? 0, oBase, share))])
      if (d.pressureShare !== null) {
        parts.push([0.2, ratio(d.pressureShare, exp((x) => x.pressureShare ?? 0, oBase, share))])
      }
      const wsum = parts.reduce((a, [w]) => a + w, 0)
      metrics.objective = parts.reduce((a, [w, v]) => a + (w / wsum) * v, 0)
    }
    if (d.lane !== null) metrics.lane = clamp(d.lane, 0.1, AKARI_METRIC_CAP)
    if (efficiencyAvailable && d.efficiency !== null) {
      metrics.efficiency = ratio(
        d.efficiency,
        pairExpected(d, (x) => x.efficiency ?? 0, gameMean.efficiency)
      )
    }
    samples.push({
      puuid: d.puuid,
      teamIdentifier: d.teamIdentifier,
      position: d.position,
      mode,
      win: d.win,
      metrics,
      bonus: d.bonus,
      afkTeammate: d.afkTeammate,
      kills: d.kills,
      surrender: d.surrender,
      gold: d.gold,
      turretTakedowns: d.turretTakedowns
    })
  }
  return samples
}

/** 用当前权重把相对指标样本折算为 0–10 评分 */
export function rateAkariSample(sample: AkariMetricSample, weightsTable = getAkariPositionWeights()) {
  const weights = weightsForSample(sample, weightsTable)
  let weightSum = 0
  let composite = 0
  for (const key of METRIC_KEYS) {
    const value = sample.metrics[key]
    if (value === undefined) continue
    weightSum += weights[key]
    composite += weights[key] * value
  }
  composite = weightSum > 0 ? composite / weightSum : 1
  composite += sample.bonus
  if (!Number.isFinite(composite)) composite = 1
  const rating = clamp(5 + 5 * Math.tanh(AKARI_SCORE_ALPHA * (composite - 1)), 0, 10)
  return Math.round(rating * 10) / 10
}

/**
 * 计算本局全部参与者的评分（含 MVP / SVP / 尽力局）。
 */
export function computeAkariScores(
  participants: AkariScoreInput[],
  gameDurationSeconds: number,
  options: AkariMetricOptions = {}
): AkariScoreResult {
  const empty = (skipped: AkariScoreResult['skipped'] = null): AkariScoreResult => ({
    byPuuid: new Map(),
    mvpPuuid: null,
    svpPuuid: null,
    skipped
  })
  if (options.earlySurrender) return empty('early-surrender')
  const samples = computeAkariMetrics(participants, gameDurationSeconds, {
    mode: options.mode,
    shareScope: options.shareScope,
    pairBlend: options.pairBlend
  })
  if (samples.length === 0) return empty()

  const scores = new Map<string, AkariScore>()
  for (const sample of samples) {
    scores.set(sample.puuid, {
      puuid: sample.puuid,
      rating: rateAkariSample(sample),
      metrics: sample.metrics,
      position: sample.position,
      isMvp: false,
      isSvp: false,
      isCarryLoss: false,
      afkTeammate: sample.afkTeammate,
      badge: null,
      tag: null
    })
  }

  // MVP：全场最高；SVP：败方最高（若其同时是全场最高则只记 MVP）；尽力局：输且 ≥ 阈值
  let mvpPuuid: string | null = null
  let best = -1
  for (const s of scores.values()) {
    if (s.rating > best) {
      best = s.rating
      mvpPuuid = s.puuid
    }
  }
  let svpPuuid: string | null = null
  let bestLoser = -1
  for (const d of samples) {
    if (d.win) continue
    const s = scores.get(d.puuid)!
    if (s.rating > bestLoser) {
      bestLoser = s.rating
      svpPuuid = s.puuid
    }
  }
  if (svpPuuid === mvpPuuid) svpPuuid = null
  for (const d of samples) {
    const s = scores.get(d.puuid)!
    s.isMvp = s.puuid === mvpPuuid
    s.isSvp = s.puuid === svpPuuid
    s.badge = s.isMvp ? 'MVP' : s.isSvp ? 'SVP' : null
  }
  assignGameTags(samples, scores, gameDurationSeconds)
  for (const s of scores.values()) s.isCarryLoss = s.tag === 'effort'

  return { byPuuid: scores, mvpPuuid, svpPuuid, skipped: null }
}

/**
 * 对局标签（WeGame 式，但按更严格、可解释的规则）：
 * - 挂机局：己方有挂机（语境标签，优先级最高，因其它标签在挂机局里都不可靠）
 * - 赢：Carry 局 = 分 ≥ carryMin 且领先队内第三高 ≥ carryLead（前两名可同时成立）；
 *       躺赢局 = 分 ≤ lyingMax 且低于队友均值 ≥ belowTeam；
 *       碾压局 = 队伍层面碾压（击杀比 ≥ 2 且 ≥ 15 杀，或对方投降且 ≤ 25 分钟）且非以上两者
 * - 输：尽力局 = 分 ≥ effortMin；
 *       甩锅局 = 分 ≤ blameMax 且全队最低且低于队友均值 ≥ belowTeam
 * 其余不打标签（"数据不够极端就不下结论"）。
 */
function assignGameTags(
  samples: AkariMetricSample[],
  scores: Map<string, AkariScore>,
  gameDurationSeconds: number
) {
  const T = AKARI_TAG_THRESHOLDS
  const teams = new Map<string, AkariMetricSample[]>()
  for (const d of samples) {
    const list = teams.get(d.teamIdentifier) ?? []
    list.push(d)
    teams.set(d.teamIdentifier, list)
  }
  // 练习工具 / 1v1 自定义等小规模对局不打标签（碾压/躺赢等概念在这里没有意义）
  if ([...teams.values()].some((list) => list.length < 3)) return
  const teamKills = new Map<string, number>()
  const teamGold = new Map<string, number>()
  for (const [key, list] of teams) {
    teamKills.set(key, list.reduce((s, d) => s + d.kills, 0))
    teamGold.set(key, list.reduce((s, d) => s + d.gold, 0))
  }
  const minutes = gameDurationSeconds / 60

  for (const [key, list] of teams) {
    const enemyKey = [...teams.keys()].find((k) => k !== key)
    const myKills = teamKills.get(key) ?? 0
    const enemyKills = enemyKey ? (teamKills.get(enemyKey) ?? 0) : 0
    const myGold = teamGold.get(key) ?? 0
    const enemyGold = enemyKey ? (teamGold.get(enemyKey) ?? 0) : 0
    const goldRatio = enemyGold > 0 ? myGold / enemyGold : 1
    const win = list[0]?.win ?? false
    const surrendered = list.some((d) => d.surrender)
    const stomp =
      win &&
      (goldRatio >= T.stompGoldRatio ||
        (myKills >= 15 && myKills >= enemyKills * T.stompKillRatio) ||
        (surrendered && minutes <= T.stompMaxMinutes && goldRatio >= T.stompSurrenderGoldRatio))
    const ratings = list.map((d) => scores.get(d.puuid)!.rating)
    const sortedDesc = [...ratings].sort((a, b) => b - a)
    const teamMin = Math.min(...ratings)

    for (const d of list) {
      const s = scores.get(d.puuid)!
      const r = s.rating
      const display = toDisplayRating(r)
      const others = ratings.filter((_, i) => list[i].puuid !== d.puuid)
      const othersAvg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : r
      const third = sortedDesc[Math.min(2, sortedDesc.length - 1)] ?? r

      if (s.afkTeammate) {
        s.tag = 'afk'
        continue
      }
      if (win) {
        if (display >= T.carryMin && r - third >= T.carryLeadInternal) s.tag = 'carry'
        else if (display <= T.lyingMax && othersAvg - r >= T.belowTeamInternal) s.tag = 'lying'
        else if (stomp) s.tag = 'stomp'
      } else {
        if (display >= T.effortMin) s.tag = 'effort'
        else if (
          display <= T.blameMax &&
          r === teamMin &&
          othersAvg - r >= T.belowTeamInternal &&
          othersAvg >= T.blameTeammatesMinInternal
        ) {
          s.tag = 'blame'
        }
      }
    }
  }
}
