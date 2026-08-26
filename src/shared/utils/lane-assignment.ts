// 全队分路指派推断：把敌方已选的 k 个英雄放进 5 条分路，
// 以「各英雄该分路出场率」的乘积（对数和）为似然，枚举全部注入映射取最优，
// 并用 softmax 给出每个英雄落在每条分路的后验概率（供置信度展示）。
// 纯函数、无依赖，便于离线单元测试。

export type LaneName = 'top' | 'jungle' | 'middle' | 'bottom' | 'utility'

export const LANE_ORDER: readonly LaneName[] = ['top', 'jungle', 'middle', 'bottom', 'utility']

/** 出场率为 0 或缺失时的平滑值，避免对数发散并保留极小可能性 */
const SMOOTHING = 0.002

export interface LaneAssignmentInput {
  championId: number
  /** 该英雄各分路出场占比（0~1，可缺省） */
  roleRates: Partial<Record<LaneName, number>>
}

export interface LaneAssignmentResult {
  /** 最优指派：分路 → 英雄 id（未被占用的分路不出现） */
  byLane: Partial<Record<LaneName, number>>
  /** 后验概率：英雄 id → 分路 → P(该英雄在该分路) */
  posterior: Record<number, Partial<Record<LaneName, number>>>
  /** 最优指派的对数似然（调试用） */
  bestLogLikelihood: number
}

function rateOf(input: LaneAssignmentInput, lane: LaneName): number {
  const r = input.roleRates[lane]
  return typeof r === 'number' && r > 0 ? r : SMOOTHING
}

/**
 * 枚举所有「英雄 → 分路」的注入映射（k ≤ 5 时最多 5!/(5-k)! = 120 种），
 * 返回最优指派与逐英雄逐分路的后验概率。
 */
export function assignLanes(inputs: LaneAssignmentInput[]): LaneAssignmentResult {
  const champs = inputs.slice(0, 5)
  const posterior: Record<number, Partial<Record<LaneName, number>>> = {}
  for (const c of champs) {
    posterior[c.championId] = {}
  }

  if (champs.length === 0) {
    return { byLane: {}, posterior, bestLogLikelihood: 0 }
  }

  interface Enumerated {
    score: number
    mapping: LaneName[] // 与 champs 同下标
  }

  const results: Enumerated[] = []
  const used = new Array<boolean>(LANE_ORDER.length).fill(false)
  const current: LaneName[] = []

  const dfs = (index: number, score: number) => {
    if (index === champs.length) {
      results.push({ score, mapping: [...current] })
      return
    }
    for (let li = 0; li < LANE_ORDER.length; li++) {
      if (used[li]) continue
      used[li] = true
      current.push(LANE_ORDER[li])
      dfs(index + 1, score + Math.log(rateOf(champs[index], LANE_ORDER[li])))
      current.pop()
      used[li] = false
    }
  }
  dfs(0, 0)

  let best = results[0]
  let maxScore = -Infinity
  for (const r of results) {
    if (r.score > maxScore) {
      maxScore = r.score
      best = r
    }
  }

  // softmax 后验（以 maxScore 平移防溢出）
  let total = 0
  const weights = results.map((r) => {
    const w = Math.exp(r.score - maxScore)
    total += w
    return w
  })
  results.forEach((r, ri) => {
    const w = weights[ri] / total
    r.mapping.forEach((lane, ci) => {
      const p = posterior[champs[ci].championId]
      p[lane] = (p[lane] ?? 0) + w
    })
  })

  const byLane: Partial<Record<LaneName, number>> = {}
  best.mapping.forEach((lane, ci) => {
    byLane[lane] = champs[ci].championId
  })

  return { byLane, posterior, bestLogLikelihood: best.score }
}

export interface LaneOpponentResolution {
  championId: number | null
  /** 后验概率（0~1），championId 为 null 时无意义 */
  probability: number
}

/** 求「我的分路」上最可能的敌方英雄及其后验概率 */
export function resolveLaneOpponent(
  inputs: LaneAssignmentInput[],
  myLane: LaneName
): LaneOpponentResolution {
  if (inputs.length === 0) {
    return { championId: null, probability: 0 }
  }
  const { posterior } = assignLanes(inputs)
  let bestId: number | null = null
  let bestP = 0
  for (const c of inputs.slice(0, 5)) {
    const p = posterior[c.championId]?.[myLane] ?? 0
    if (p > bestP) {
      bestP = p
      bestId = c.championId
    }
  }
  return { championId: bestId, probability: bestP }
}
