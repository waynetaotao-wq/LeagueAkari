import type { ReviewEarlyFacts, ReviewMatch } from './types'

// [lolps] 胜负差异只描述赢局与输局这两组样本有什么不同，不证明因果：落后本身也会让
// 装备变慢、死亡变多。以下门槛都是展示规则，不是对玩家水平的判定。
export const REVIEW_GAP_MIN_SIDE = 5
export const REVIEW_GAP_CLEAR_MIN_SIDE = 8
/** 双侧约 5% 与 1%。同时比较十几项指标，「差别明显」因此采用更严的一档。 */
export const REVIEW_GAP_POSSIBLE_Z = 1.96
export const REVIEW_GAP_CLEAR_Z = 2.58

export type ReviewGapMetricId =
  | 'deathsBefore10'
  | 'soloDeathsBefore14'
  | 'jungleDeathsBefore14'
  | 'firstShopAt'
  | 'wardsBefore10'
  | 'controlWardsBefore15'
  | 'roamsBefore14'
  | 'cs10'
  | 'csDiff10'
  | 'goldDiff10'
  | 'goldDiff15'
  | 'plateDiff'
  | 'takedownsBefore14'
  | 'firstCoreItemAt'

export type ReviewGapUnit = 'count' | 'time' | 'gold' | 'cs' | 'plates'
export type ReviewGapStrength = 'insufficient' | 'none' | 'possible' | 'clear'

export interface ReviewGapMetric {
  id: ReviewGapMetricId
  /** habit: something the player decides directly. result: how the lane turned out. */
  group: 'habit' | 'result'
  unit: ReviewGapUnit
  /** Small counts read better as an average; skewed times and gold as the middle game. */
  center: 'mean' | 'median'
  read(match: ReviewMatch): number | null
}

const early =
  (key: keyof ReviewEarlyFacts) =>
  (match: ReviewMatch): number | null =>
    match.early?.[key] ?? null
const snapshot =
  (minute: 10 | 15, key: 'personalGoldDiff' | 'personalCsDiff') =>
  (match: ReviewMatch): number | null =>
    match.snapshots.find((value) => value.minute === minute)?.[key] ?? null

export const REVIEW_GAP_METRICS: readonly ReviewGapMetric[] = [
  {
    id: 'deathsBefore10',
    group: 'habit',
    unit: 'count',
    center: 'mean',
    read: early('deathsBefore10')
  },
  {
    id: 'soloDeathsBefore14',
    group: 'habit',
    unit: 'count',
    center: 'mean',
    read: early('soloDeathsBefore14')
  },
  {
    id: 'jungleDeathsBefore14',
    group: 'habit',
    unit: 'count',
    center: 'mean',
    read: early('jungleDeathsBefore14')
  },
  { id: 'firstShopAt', group: 'habit', unit: 'time', center: 'median', read: early('firstShopAt') },
  {
    id: 'wardsBefore10',
    group: 'habit',
    unit: 'count',
    center: 'mean',
    read: early('wardsBefore10')
  },
  {
    id: 'controlWardsBefore15',
    group: 'habit',
    unit: 'count',
    center: 'mean',
    read: early('controlWardsBefore15')
  },
  {
    id: 'roamsBefore14',
    group: 'habit',
    unit: 'count',
    center: 'mean',
    read: early('roamsBefore14')
  },
  { id: 'cs10', group: 'result', unit: 'cs', center: 'median', read: early('cs10') },
  {
    id: 'csDiff10',
    group: 'result',
    unit: 'cs',
    center: 'median',
    read: snapshot(10, 'personalCsDiff')
  },
  {
    id: 'goldDiff10',
    group: 'result',
    unit: 'gold',
    center: 'median',
    read: snapshot(10, 'personalGoldDiff')
  },
  {
    id: 'goldDiff15',
    group: 'result',
    unit: 'gold',
    center: 'median',
    read: snapshot(15, 'personalGoldDiff')
  },
  {
    id: 'plateDiff',
    group: 'result',
    unit: 'plates',
    center: 'mean',
    read: (match) =>
      match.early?.platesTaken == null || match.early.platesLost == null
        ? null
        : match.early.platesTaken - match.early.platesLost
  },
  {
    id: 'takedownsBefore14',
    group: 'result',
    unit: 'count',
    center: 'mean',
    read: early('takedownsBefore14')
  },
  {
    id: 'firstCoreItemAt',
    group: 'result',
    unit: 'time',
    center: 'median',
    read: early('firstCoreItemAt')
  }
]

export interface ReviewGapValue {
  gameId: number
  gameCreation: number
  value: number
}

export interface ReviewGapSide {
  samples: number
  /** The mean or median chosen by the metric. */
  center: number | null
  mean: number | null
  median: number | null
  q1: number | null
  q3: number | null
  min: number | null
  max: number | null
  /** One entry per game with a measurable value, ascending. */
  values: ReviewGapValue[]
}

export interface ReviewGapRow {
  metric: ReviewGapMetric
  win: ReviewGapSide
  loss: ReviewGapSide
  /** Loss centre minus win centre. */
  difference: number | null
  /**
   * Chance that a randomly chosen lost game has a higher value than a randomly chosen won game,
   * ties counting half. 0.5 means the two groups cannot be told apart.
   */
  separation: number | null
  z: number | null
  strength: ReviewGapStrength
}

export interface ReviewGapReport {
  games: number
  wins: number
  losses: number
  /** Archived before early-game measurements were kept; only snapshot metrics can use them. */
  legacyGames: number
  rows: ReviewGapRow[]
}

function quantile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function summarizeSide(values: ReviewGapValue[], center: 'mean' | 'median'): ReviewGapSide {
  const ordered = [...values].sort((a, b) => a.value - b.value || a.gameId - b.gameId)
  if (!ordered.length)
    return {
      samples: 0,
      center: null,
      mean: null,
      median: null,
      q1: null,
      q3: null,
      min: null,
      max: null,
      values: []
    }
  const numbers = ordered.map((item) => item.value)
  const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length
  const median = quantile(numbers, 0.5)
  return {
    samples: numbers.length,
    center: center === 'mean' ? mean : median,
    mean,
    median,
    q1: quantile(numbers, 0.25),
    q3: quantile(numbers, 0.75),
    min: numbers[0],
    max: numbers.at(-1)!,
    values: ordered
  }
}

/** Mann–Whitney rank comparison with tie and continuity corrections; makes no normality claim. */
export function compareReviewSamples(
  win: number[],
  loss: number[]
): { separation: number; z: number } | null {
  if (!win.length || !loss.length) return null
  const all = [
    ...loss.map((value) => ({ value, loss: true })),
    ...win.map((value) => ({ value, loss: false }))
  ].sort((a, b) => a.value - b.value)
  let lossRankSum = 0
  let tieTerm = 0
  for (let start = 0; start < all.length;) {
    let end = start
    while (end < all.length && all[end].value === all[start].value) end++
    const rank = (start + 1 + end) / 2
    const ties = end - start
    tieTerm += ties ** 3 - ties
    for (let index = start; index < end; index++) if (all[index].loss) lossRankSum += rank
    start = end
  }
  const pairs = win.length * loss.length
  const total = win.length + loss.length
  const u = lossRankSum - (loss.length * (loss.length + 1)) / 2
  const variance = (pairs / 12) * (total + 1 - tieTerm / (total * (total - 1)))
  const delta = u - pairs / 2
  return {
    separation: u / pairs,
    z:
      variance > 0
        ? (Math.sign(delta) * Math.max(0, Math.abs(delta) - 0.5)) / Math.sqrt(variance)
        : 0
  }
}

export function compareReviewOutcomes(matches: ReviewMatch[]): ReviewGapReport {
  const unique = new Map<string, ReviewMatch>()
  for (const match of matches) {
    const key = `${match.meta.sgpServerId}:${match.meta.gameId}:${match.meta.puuid}`
    if (!unique.has(key)) unique.set(key, match)
  }
  const games = [...unique.values()]
  const rows = REVIEW_GAP_METRICS.map((metric): ReviewGapRow => {
    const values = (won: boolean) =>
      games.flatMap((match) => {
        if (match.meta.win !== won) return []
        const value = metric.read(match)
        return value === null || !Number.isFinite(value)
          ? []
          : [{ gameId: match.meta.gameId, gameCreation: match.meta.gameCreation, value }]
      })
    const win = summarizeSide(values(true), metric.center)
    const loss = summarizeSide(values(false), metric.center)
    const comparison = compareReviewSamples(
      win.values.map((item) => item.value),
      loss.values.map((item) => item.value)
    )
    const smaller = Math.min(win.samples, loss.samples)
    const z = comparison ? Math.abs(comparison.z) : 0
    return {
      metric,
      win,
      loss,
      difference: win.center === null || loss.center === null ? null : loss.center - win.center,
      separation: comparison?.separation ?? null,
      z: comparison?.z ?? null,
      strength:
        smaller < REVIEW_GAP_MIN_SIDE
          ? 'insufficient'
          : z >= REVIEW_GAP_CLEAR_Z && smaller >= REVIEW_GAP_CLEAR_MIN_SIDE
            ? 'clear'
            : z >= REVIEW_GAP_POSSIBLE_Z
              ? 'possible'
              : 'none'
    }
  })
  const wins = games.filter((match) => match.meta.win).length
  return {
    games: games.length,
    wins,
    losses: games.length - wins,
    legacyGames: games.filter((match) => !match.early).length,
    rows
  }
}

const STRENGTH_ORDER: Record<ReviewGapStrength, number> = {
  clear: 0,
  possible: 1,
  none: 2,
  insufficient: 3
}

/** Strongest separation first; the catalogue order breaks ties so the list never reshuffles. */
export function sortReviewGapRows(rows: ReviewGapRow[]): ReviewGapRow[] {
  return [...rows].sort(
    (a, b) =>
      STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] ||
      Math.abs((b.separation ?? 0.5) - 0.5) - Math.abs((a.separation ?? 0.5) - 0.5) ||
      REVIEW_GAP_METRICS.indexOf(a.metric) - REVIEW_GAP_METRICS.indexOf(b.metric)
  )
}
