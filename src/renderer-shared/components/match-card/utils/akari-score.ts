/**
 * [lolps] Akari 评分（对局内个人表现评分，OP.GG OP Score 同类思路）
 *
 * 设计原则（与手册 §10.26 一致）：
 * 1. 归一化：每项指标换成"占队伍份额"或"每分钟"，再除以本局期望值 → 比率 r（1.0 = 本局平均水平）
 * 2. 分路加权：五个位置各一组权重；位置未知时用通用配置（打野/辅助可由数据推断）
 * 3. 局内相对：只在本局 10 人内比较，不受版本 / 段位 / 模式影响
 * 4. 映射：composite（≈1.0 平均）→ 5 + 5·tanh(α·(c−1))，压到 0–10
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
}

export type AkariMetricKey =
  | 'damage'
  | 'taken'
  | 'kp'
  | 'deaths'
  | 'gold'
  | 'cs'
  | 'vision'
  | 'cc'
  | 'tower'

export interface AkariScore {
  puuid: string
  rating: number
  /** 各指标比率（1.0 = 本局期望），用于悬浮拆解 */
  metrics: Partial<Record<AkariMetricKey, number>>
  position: AkariScorePosition
  isMvp: boolean
  isSvp: boolean
  /** 输了但表现在阈值之上 */
  isCarryLoss: boolean
}

export interface AkariScoreResult {
  byPuuid: Map<string, AkariScore>
  mvpPuuid: string | null
  svpPuuid: string | null
}

/** 映射曲线陡峭度：c=1.35 → ≈8.5，c=1.6 → ≈9.5，c=0.7 → ≈1.8，c=1.05 → ≈5.6 */
export const AKARI_SCORE_ALPHA = 2.5
/** 单项比率上限：防止极端值（如 0 死亡）压过其它维度 */
export const AKARI_METRIC_CAP = 2.5
/** 尽力局阈值（0–10 量表） */
export const AKARI_CARRY_LOSS_THRESHOLD = 8.0

export const AKARI_METRIC_LABELS: Record<AkariMetricKey, string> = {
  damage: '输出',
  taken: '承伤',
  kp: '参团',
  deaths: '生存',
  gold: '经济',
  cs: '补刀',
  vision: '视野',
  cc: '控制',
  tower: '推塔'
}

/** 分路权重（可调区；每组和为 1，代码里会再归一化，改动时无需手工配平） */
export const AKARI_POSITION_WEIGHTS: Record<AkariScorePosition, Record<AkariMetricKey, number>> = {
  TOP: { damage: 0.22, taken: 0.18, kp: 0.1, deaths: 0.15, gold: 0.12, cs: 0.1, vision: 0.03, cc: 0.05, tower: 0.05 },
  JUNGLE: { damage: 0.15, taken: 0.12, kp: 0.22, deaths: 0.15, gold: 0.12, cs: 0.06, vision: 0.08, cc: 0.05, tower: 0.05 },
  MIDDLE: { damage: 0.26, taken: 0.03, kp: 0.16, deaths: 0.15, gold: 0.14, cs: 0.12, vision: 0.05, cc: 0.05, tower: 0.04 },
  BOTTOM: { damage: 0.28, taken: 0.02, kp: 0.12, deaths: 0.15, gold: 0.15, cs: 0.14, vision: 0.04, cc: 0.02, tower: 0.08 },
  UTILITY: { damage: 0.1, taken: 0.12, kp: 0.22, deaths: 0.14, gold: 0.04, cs: 0.02, vision: 0.2, cc: 0.14, tower: 0.02 },
  UNKNOWN: { damage: 0.22, taken: 0.1, kp: 0.15, deaths: 0.15, gold: 0.13, cs: 0.1, vision: 0.06, cc: 0.05, tower: 0.04 }
}

const METRIC_KEYS: AkariMetricKey[] = [
  'damage',
  'taken',
  'kp',
  'deaths',
  'gold',
  'cs',
  'vision',
  'cc',
  'tower'
]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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
  if (team.length !== 5) {
    for (const p of team) out.set(p.puuid, normalizePosition(p.position))
    return out
  }
  const known = team.filter((p) => normalizePosition(p.position) !== 'UNKNOWN')
  if (known.length === team.length) {
    for (const p of team) out.set(p.puuid, normalizePosition(p.position))
    return out
  }
  const byJungle = [...team].sort((a, b) => b.neutralMinionsKilled - a.neutralMinionsKilled)
  const jungle = byJungle[0].neutralMinionsKilled >= 20 ? byJungle[0] : null
  const rest = team.filter((p) => p !== jungle)
  const bySupport = [...rest].sort((a, b) => a.cs - b.cs || b.visionScore - a.visionScore)
  const support = bySupport[0]
  for (const p of team) {
    if (p === jungle) out.set(p.puuid, 'JUNGLE')
    else if (p === support) out.set(p.puuid, 'UTILITY')
    else out.set(p.puuid, 'UNKNOWN')
  }
  return out
}

interface DerivedMetrics {
  puuid: string
  teamIdentifier: string
  win: boolean
  position: AkariScorePosition
  dmgShare: number
  takenShare: number
  towerShare: number
  kp: number
  deathShare: number
  gpm: number
  cspm: number
  vspm: number
  ccpm: number
  bonus: number
}

/**
 * 计算本局全部参与者的评分。仅对两队（5v5 / 大乱斗等）有意义；
 * 参与者不足 2 人或时长为 0 时返回空结果。
 */
export function computeAkariScores(
  participants: AkariScoreInput[],
  gameDurationSeconds: number
): AkariScoreResult {
  const empty: AkariScoreResult = { byPuuid: new Map(), mvpPuuid: null, svpPuuid: null }
  const minutes = safeNumber(gameDurationSeconds) / 60
  if (participants.length < 2 || minutes <= 0) return empty

  const teams = new Map<string, AkariScoreInput[]>()
  for (const p of participants) {
    const list = teams.get(p.teamIdentifier) ?? []
    list.push(p)
    teams.set(p.teamIdentifier, list)
  }
  if (teams.size !== 2) return empty

  const positionByPuuid = new Map<string, AkariScorePosition>()
  for (const team of teams.values()) {
    for (const [puuid, position] of inferPositions(team)) positionByPuuid.set(puuid, position)
  }

  // 队伍份额
  const derived: DerivedMetrics[] = []
  for (const team of teams.values()) {
    const teamKills = team.reduce((s, p) => s + safeNumber(p.kills), 0)
    const teamDeaths = team.reduce((s, p) => s + safeNumber(p.deaths), 0)
    const teamDmg = team.reduce((s, p) => s + safeNumber(p.totalDamageDealtToChampions), 0)
    const teamTaken = team.reduce((s, p) => s + safeNumber(p.totalDamageTaken), 0)
    const teamTower = team.reduce((s, p) => s + safeNumber(p.totalDamageToTowers), 0)
    const size = team.length
    for (const p of team) {
      const kills = safeNumber(p.kills)
      const deaths = safeNumber(p.deaths)
      const assists = safeNumber(p.assists)
      const multi =
        safeNumber(p.doubleKills) * 0.03 +
        safeNumber(p.tripleKills) * 0.06 +
        safeNumber(p.quadraKills) * 0.1 +
        safeNumber(p.pentaKills) * 0.15
      const solo = clamp(safeNumber(p.soloKills), 0, 5) * 0.02
      derived.push({
        puuid: p.puuid,
        teamIdentifier: p.teamIdentifier,
        win: p.win,
        position: positionByPuuid.get(p.puuid) ?? 'UNKNOWN',
        dmgShare: teamDmg > 0 ? safeNumber(p.totalDamageDealtToChampions) / teamDmg : 1 / size,
        takenShare: teamTaken > 0 ? safeNumber(p.totalDamageTaken) / teamTaken : 1 / size,
        towerShare: teamTower > 0 ? safeNumber(p.totalDamageToTowers) / teamTower : 1 / size,
        kp: teamKills > 0 ? (kills + assists) / teamKills : 0,
        deathShare: teamDeaths > 0 ? deaths / teamDeaths : 0,
        gpm: safeNumber(p.goldEarned) / minutes,
        cspm: safeNumber(p.cs) / minutes,
        vspm: safeNumber(p.visionScore) / minutes,
        ccpm: safeNumber(p.timeCCingOthers) / minutes,
        bonus: clamp(multi + solo, 0, 0.3)
      })
    }
  }

  // 每分钟类指标的期望：同位置对手可比时取两人均值，否则取全局均值
  const gameMean = {
    kp: mean(derived.map((d) => d.kp)),
    gpm: mean(derived.map((d) => d.gpm)),
    cspm: mean(derived.map((d) => d.cspm)),
    vspm: mean(derived.map((d) => d.vspm)),
    ccpm: mean(derived.map((d) => d.ccpm))
  }
  const counterpart = (d: DerivedMetrics) =>
    d.position === 'UNKNOWN'
      ? null
      : (derived.find((o) => o.teamIdentifier !== d.teamIdentifier && o.position === d.position) ??
        null)
  const ratio = (value: number, expected: number) =>
    expected > 0 ? clamp(value / expected, 0, AKARI_METRIC_CAP) : value > 0 ? AKARI_METRIC_CAP : 1
  const pairExpected = (d: DerivedMetrics, key: 'gpm' | 'cspm', fallback: number) => {
    const c = counterpart(d)
    return c ? (d[key] + c[key]) / 2 : fallback
  }

  const teamSize = (d: DerivedMetrics) => teams.get(d.teamIdentifier)?.length ?? 5
  // 某项原始数据整局为 0（数据源未提供）时剔除该项，权重自动归一到其余项，避免被 1.0 稀释
  const rawAllZero = (key: keyof AkariScoreInput) =>
    participants.every((p) => safeNumber(p[key]) === 0)
  const droppedMetrics = new Set<AkariMetricKey>()
  if (rawAllZero('visionScore')) droppedMetrics.add('vision')
  if (rawAllZero('timeCCingOthers')) droppedMetrics.add('cc')
  if (rawAllZero('totalDamageToTowers')) droppedMetrics.add('tower')
  if (rawAllZero('totalDamageTaken')) droppedMetrics.add('taken')

  const scores = new Map<string, AkariScore>()
  for (const d of derived) {
    const size = teamSize(d)
    const share = 1 / size
    const metrics: Partial<Record<AkariMetricKey, number>> = {
      damage: ratio(d.dmgShare, share),
      taken: ratio(d.takenShare, share),
      kp: ratio(d.kp, gameMean.kp),
      // 死亡份额越低越好：份额=平均 → 1.0；0 死亡 → 上限
      deaths: clamp((1 - d.deathShare) / (1 - share), 0, AKARI_METRIC_CAP),
      gold: ratio(d.gpm, pairExpected(d, 'gpm', gameMean.gpm)),
      cs: ratio(d.cspm, pairExpected(d, 'cspm', gameMean.cspm)),
      vision: ratio(d.vspm, gameMean.vspm),
      cc: ratio(d.ccpm, gameMean.ccpm),
      tower: ratio(d.towerShare, share)
    }
    for (const key of droppedMetrics) delete metrics[key]

    const weights = AKARI_POSITION_WEIGHTS[d.position]
    let weightSum = 0
    let composite = 0
    for (const key of METRIC_KEYS) {
      const value = metrics[key]
      if (value === undefined) continue
      weightSum += weights[key]
      composite += weights[key] * value
    }
    composite = weightSum > 0 ? composite / weightSum : 1
    composite += d.bonus

    const rating = clamp(5 + 5 * Math.tanh(AKARI_SCORE_ALPHA * (composite - 1)), 0, 10)
    scores.set(d.puuid, {
      puuid: d.puuid,
      rating: Math.round(rating * 10) / 10,
      metrics,
      position: d.position,
      isMvp: false,
      isSvp: false,
      isCarryLoss: false
    })
  }

  // MVP：全场最高；SVP：败方最高（若其同时是全场最高则只记 MVP）；尽力局：输且 ≥ 阈值
  let mvpPuuid: string | null = null
  let svpPuuid: string | null = null
  let best = -1
  for (const s of scores.values()) {
    if (s.rating > best) {
      best = s.rating
      mvpPuuid = s.puuid
    }
  }
  let bestLoser = -1
  for (const d of derived) {
    if (d.win) continue
    const s = scores.get(d.puuid)!
    if (s.rating > bestLoser) {
      bestLoser = s.rating
      svpPuuid = s.puuid
    }
  }
  if (svpPuuid === mvpPuuid) svpPuuid = null
  for (const d of derived) {
    const s = scores.get(d.puuid)!
    s.isMvp = s.puuid === mvpPuuid
    s.isSvp = s.puuid === svpPuuid
    s.isCarryLoss = !d.win && s.rating >= AKARI_CARRY_LOSS_THRESHOLD
  }

  return { byPuuid: scores, mvpPuuid, svpPuuid }
}
