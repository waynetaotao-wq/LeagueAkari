/**
 * [lolps] 海克斯大乱斗（ARAM: Mayhem）阵容选择打分器
 *
 * 数据：OP.GG Mayhem 专属面（原版已接入）——
 *   champions（该模式英雄胜率）+ synergies（英雄组合协同胜率）。
 * 决策：对"你当前可拿的英雄"（手持 + 板凳）逐个打分排序：
 *   分数 = 该英雄 Mayhem 胜率(基分) + 与我方已确认英雄的协同修正（组合胜率相对 50% 的偏离）。
 */

// ============================ 可调区 ============================

/**
 * 协同净增量权重。协同项已做"去基线"（组合胜率 − 成员基础胜率均值，
 * 消除个体强度双重计分），因此可接近全额计入。
 */
export const SYNERGY_WEIGHT = 0.8
/** 最多计入的协同组合条数（防单英雄组合刷分） */
export const SYNERGY_MAX_HITS = 2
/** 无胜率数据时的基分兜底 */
export const FALLBACK_WIN_RATE = 0.5
/**
 * 本人熟练度修正（只作用于候选英雄×你自己——队友英雄已锁定，修正队友不改排序）：
 * 分档 [熟练度下限, 修正值]，取首个命中档；完全不熟（低于末档下限）按 UNFAMILIAR 扣分。
 */
export const MASTERY_TIERS: ReadonlyArray<[number, number]> = [
  [100_000, 0.008],
  [30_000, 0.005],
  [10_000, 0.0025]
]
export const MASTERY_UNFAMILIAR_ADJ = -0.005

export function masteryAdjustment(points: number | null | undefined): number {
  if (typeof points !== 'number') return 0
  for (const [min, adj] of MASTERY_TIERS) {
    if (points >= min) return adj
  }
  return MASTERY_UNFAMILIAR_ADJ
}
/**
 * 贝叶斯收缩先验（以登场率为样本代理）：
 * 有效胜率 = 50% + (实测-50%) × pickRate/(pickRate+此值)。
 * 登场率 1% 的条目权重减半，低样本噪声自动向中性收缩；无登场率数据不收缩。
 */
export const PRIOR_PICK_RATE = 0.01

/** 按登场率收缩胜率（登场率缺失=视为样本充分，不收缩） */
export function shrinkWinRate(winRate: number, pickRate: number | null | undefined): number {
  if (typeof pickRate !== 'number' || pickRate <= 0) return winRate
  const w = pickRate / (pickRate + PRIOR_PICK_RATE)
  return 0.5 + (winRate - 0.5) * w
}

// ============================ 类型 ==============================

export interface MayhemChampionRow {
  championId: number
  performance?: { winRate?: number | null; pickRate?: number | null; rank?: number | null }
  winRate?: number | null
}

export interface MayhemSynergyRow {
  championIds: number[]
  performance: { winRate: number | null; pickRate?: number | null; rank?: number | null }
}

export interface SynergyHit {
  withIds: number[]
  winRate: number
}

export interface MayhemPickAdvice {
  championId: number
  /** 综合分（胜率量纲，0-1） */
  score: number
  /** 该英雄 Mayhem 基础胜率（无数据为 null） */
  baseWinRate: number | null
  /** 命中的协同组合（含队友） */
  synergyHits: SynergyHit[]
  /** 拿该英雄后的队伍预估胜率（DraftGap 式团队口径，含本人熟练修正） */
  teamWinRate: number
  /** 本人熟练度修正量（已计入分数） */
  masteryAdj: number
}

// ============================ 逻辑 ==============================

/**
 * 队伍预估胜率（团队口径）：
 *   五人基础胜率均值 + 全队命中的协同组合修正（(组合胜率-50%)×权重，摊到团队规模）。
 * 协同表只覆盖统计显著的热门组合，未覆盖组合按中性（不加不减）处理。
 */
export function estimateTeamWinRate(
  myPick: number,
  teammates: number[],
  champMap: Map<number, MayhemChampionRow>,
  synergies: MayhemSynergyRow[]
): number {
  const team = [myPick, ...teammates.filter((x) => typeof x === 'number' && x > 0)]
  if (team.length === 0) return FALLBACK_WIN_RATE
  const teamSet = new Set(team)

  let base = 0
  for (const id of team) {
    base += baseWinRateOf(champMap.get(id)) ?? FALLBACK_WIN_RATE
  }
  base /= team.length

  let synergyAdj = 0
  for (const syn of synergies) {
    if (!Array.isArray(syn?.championIds) || syn.championIds.length < 2) continue
    if (!syn.championIds.every((x) => teamSet.has(x))) continue
    const wr = syn.performance?.winRate
    if (typeof wr !== 'number') continue
    synergyAdj += synergyLift(syn, wr, champMap) * SYNERGY_WEIGHT
  }

  return base + synergyAdj / team.length
}

/** 协同净增量：组合实测胜率（收缩后）− 组合成员基础胜率均值（去除个体强度双重计分） */
function synergyLift(
  syn: MayhemSynergyRow,
  rawWr: number,
  champMap: Map<number, MayhemChampionRow>
): number {
  const wr = shrinkWinRate(rawWr, syn.performance?.pickRate)
  let memberBase = 0
  for (const id of syn.championIds) {
    memberBase += baseWinRateOf(champMap.get(id)) ?? FALLBACK_WIN_RATE
  }
  memberBase /= syn.championIds.length
  return wr - memberBase
}

function baseWinRateOf(row: MayhemChampionRow | undefined): number | null {
  if (!row) return null
  const v = row.performance?.winRate ?? row.winRate
  if (typeof v !== 'number') return null
  return shrinkWinRate(v, row.performance?.pickRate)
}

/**
 * 对候选英雄打分排序。
 * @param candidates 你可拿的英雄（当前手持 + 板凳），去重后逐个评估
 * @param teammates 我方已确认的其他英雄
 */
export function scoreMayhemPicks(
  candidates: number[],
  teammates: number[],
  champions: MayhemChampionRow[],
  synergies: MayhemSynergyRow[],
  opts: { masteryPointsOf?: (championId: number) => number | null } = {}
): MayhemPickAdvice[] {
  const champMap = new Map<number, MayhemChampionRow>()
  for (const c of champions) {
    if (typeof c?.championId === 'number') champMap.set(c.championId, c)
  }
  const mates = new Set(teammates.filter((x) => typeof x === 'number' && x > 0))

  const advices: MayhemPickAdvice[] = []
  const seen = new Set<number>()
  for (const id of candidates) {
    if (typeof id !== 'number' || id <= 0 || seen.has(id)) continue
    seen.add(id)

    const base = baseWinRateOf(champMap.get(id))

    // 协同：包含该候选且其余成员全为我方队友的组合
    const hits: SynergyHit[] = []
    for (const syn of synergies) {
      if (!Array.isArray(syn?.championIds) || syn.championIds.length < 2) continue
      if (!syn.championIds.includes(id)) continue
      const others = syn.championIds.filter((x) => x !== id)
      if (others.length === 0 || !others.every((x) => mates.has(x))) continue
      const wr = syn.performance?.winRate
      if (typeof wr !== 'number') continue
      hits.push({ withIds: others, winRate: wr })
    }
    hits.sort((a, b) => Math.abs(b.winRate - 0.5) - Math.abs(a.winRate - 0.5))
    const used = hits.slice(0, SYNERGY_MAX_HITS)

    let score = base ?? FALLBACK_WIN_RATE
    for (const h of used) {
      const syn = synergies.find(
        (x) => x.championIds.includes(id) && h.withIds.every((w) => x.championIds.includes(w))
      )
      if (syn) score += synergyLift(syn, h.winRate, champMap) * SYNERGY_WEIGHT
    }

    const mAdj = masteryAdjustment(opts.masteryPointsOf?.(id))
    advices.push({
      championId: id,
      score: score + mAdj,
      baseWinRate: base,
      synergyHits: used,
      teamWinRate: estimateTeamWinRate(id, teammates, champMap, synergies) + mAdj / 5,
      masteryAdj: mAdj
    })
  }

  return advices.sort(
    (a, b) => b.score - a.score || (b.baseWinRate ?? -1) - (a.baseWinRate ?? -1)
  )
}
