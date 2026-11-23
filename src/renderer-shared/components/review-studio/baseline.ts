import { REVIEW_DIGEST_METRIC_KEYS, type ReviewDigestMetricKey } from './match-digest'
import type { ReviewDigest, ReviewMatch } from './types'

// [lolps] 个人基线：拿本机档案里同一个人的其它对局当「平时」，看这一局的各项数字落在平时的什么位置。
// 只描述位置，不解释原因；样本来自本机档案，不是完整战绩。

/** 少于这个局数不给基线：三五局说明不了「平时」。 */
export const REVIEW_BASELINE_MIN_GAMES = 5
/** 只取最近这么多局，免得很久以前的水平拖着基线。 */
export const REVIEW_BASELINE_MAX_GAMES = 60

/** Which games the baseline is built from, narrowest first. */
export type ReviewBaselineScope = 'matchup' | 'champion' | 'position'

export type ReviewMetricUnit =
  /** Whole numbers: kills, wards, fights. */
  | 'count'
  /** Per-minute values and other decimals. */
  | 'rate'
  /** Fractions shown as percent. */
  | 'share'
  /** Milliseconds from game start. */
  | 'time'
  /** Seconds. */
  | 'seconds'
  | 'gold'
  /** Own minus opponent; shown with a sign. */
  | 'diff'

/** Whether more is better, worse, or says nothing by itself. */
export type ReviewMetricPolarity = 'higher' | 'lower' | null

const meta = (unit: ReviewMetricUnit, better: ReviewMetricPolarity) => ({ unit, better })

const CHECKPOINT_META = Object.fromEntries(
  [5, 10, 15, 20].flatMap((minute) => [
    [`cs${minute}`, meta('count', 'higher')],
    [`goldDiff${minute}`, meta('diff', 'higher')],
    [`csDiff${minute}`, meta('diff', 'higher')],
    [`xpDiff${minute}`, meta('diff', 'higher')],
    [`levelDiff${minute}`, meta('diff', 'higher')]
  ])
)

/**
 * Unit and direction of every digest metric. Direction is left empty where a higher number is
 * not clearly good or bad: damage taken depends on the role, casts and recalls on the game.
 */
export const REVIEW_DIGEST_METRIC_META = {
  kills: meta('count', 'higher'),
  deaths: meta('count', 'lower'),
  assists: meta('count', 'higher'),
  level: meta('count', 'higher'),
  cs: meta('count', 'higher'),
  csPerMinute: meta('rate', 'higher'),
  gold: meta('gold', 'higher'),
  goldPerMinute: meta('rate', 'higher'),
  damage: meta('count', 'higher'),
  damagePerMinute: meta('rate', 'higher'),
  damageTaken: meta('count', null),
  damageTakenPerMinute: meta('rate', null),
  damageShare: meta('share', 'higher'),
  damageTakenShare: meta('share', null),
  goldShare: meta('share', 'higher'),
  killParticipation: meta('share', 'higher'),
  visionScore: meta('count', 'higher'),
  visionPerMinute: meta('rate', 'higher'),
  wardsPlaced: meta('count', 'higher'),
  wardsKilled: meta('count', 'higher'),
  controlWardsBought: meta('count', 'higher'),
  secondsDead: meta('seconds', 'lower'),
  deadShare: meta('share', 'lower'),
  unspentGold: meta('gold', null),
  summoner1Casts: meta('count', null),
  summoner2Casts: meta('count', null),
  ultimateCasts: meta('count', null),
  csDiffEnd: meta('diff', 'higher'),
  goldDiffEnd: meta('diff', 'higher'),
  damageDiffEnd: meta('diff', 'higher'),
  visionDiffEnd: meta('diff', 'higher'),
  levelDiffEnd: meta('diff', 'higher'),
  level2Lead: meta('diff', 'higher'),
  level6At: meta('time', 'lower'),
  level6Lead: meta('diff', 'higher'),
  level11At: meta('time', 'lower'),
  level16At: meta('time', 'lower'),
  firstCoreAt: meta('time', 'lower'),
  secondCoreAt: meta('time', 'lower'),
  thirdCoreAt: meta('time', 'lower'),
  bootsAt: meta('time', null),
  firstRecallAt: meta('time', null),
  recalls: meta('count', null),
  takedowns: meta('count', 'higher'),
  soloKills: meta('count', 'higher'),
  soloDeaths: meta('count', 'lower'),
  executions: meta('count', 'lower'),
  firstBloodTakedown: meta('count', 'higher'),
  fights: meta('count', null),
  fightsJoined: meta('count', null),
  fightsWon: meta('count', 'higher'),
  fightsLost: meta('count', 'lower'),
  fightsDiedFirst: meta('count', 'lower'),
  deathsInFights: meta('count', 'lower'),
  deathsOutsideFights: meta('count', 'lower'),
  epicOwn: meta('count', 'higher'),
  epicEnemy: meta('count', 'lower'),
  epicCredited: meta('count', 'higher'),
  towersOwn: meta('count', 'higher'),
  towersEnemy: meta('count', 'lower'),
  towersCredited: meta('count', 'higher'),
  enemyObjectivesAfterDeath: meta('count', 'lower'),
  wardEvents: meta('count', 'higher'),
  controlWardsPlaced: meta('count', 'higher'),
  wardsCleared: meta('count', 'higher'),
  ...CHECKPOINT_META
} as Record<ReviewDigestMetricKey, { unit: ReviewMetricUnit; better: ReviewMetricPolarity }>

export interface ReviewBaselineMetric {
  /** Known values of the baseline games, ascending. */
  values: number[]
  samples: number
  median: number | null
  q1: number | null
  q3: number | null
  mean: number | null
}

export interface ReviewBaseline {
  scope: ReviewBaselineScope
  games: number
  wins: number
  /** Creation time of the oldest and the newest baseline game. */
  from: number
  to: number
  metrics: Record<ReviewDigestMetricKey, ReviewBaselineMetric>
}

/** Linear-interpolated quantile of ascending values; null for an empty list. */
function quantile(values: number[], fraction: number) {
  if (!values.length) return null
  const position = (values.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return values[lower] + (values[upper] - values[lower]) * (position - lower)
}

function summarize(values: number[]): ReviewBaselineMetric {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    values: sorted,
    samples: sorted.length,
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    mean: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null
  }
}

/** Typical numbers of the given games; games without a digest contribute nothing. */
export function buildReviewBaseline(
  matches: readonly ReviewMatch[],
  scope: ReviewBaselineScope
): ReviewBaseline | null {
  const games = matches.filter((match) => match.digest)
  if (!games.length) return null
  const metrics = {} as ReviewBaseline['metrics']
  for (const key of REVIEW_DIGEST_METRIC_KEYS) {
    metrics[key] = summarize(
      games.flatMap((match) => {
        const value = match.digest!.metrics[key]
        return typeof value === 'number' && Number.isFinite(value) ? [value] : []
      })
    )
  }
  const created = games.map((match) => match.meta.gameCreation)
  return {
    scope,
    games: games.length,
    wins: games.filter((match) => match.meta.win).length,
    from: Math.min(...created),
    to: Math.max(...created),
    metrics
  }
}

/**
 * The baseline for one game: the same player's other archived games, as close to this game as
 * the archive allows. Tries the same matchup first, then the same champion in the same role,
 * then the role alone, and takes the first with enough games. null when none has.
 */
export function selectReviewBaseline(
  target: ReviewMatch,
  archive: readonly ReviewMatch[]
): ReviewBaseline | null {
  const { meta } = target
  // 位置都认不出来的对局，没有可比的「同位置」。
  if (meta.position === 'UNKNOWN') return null
  const seen = new Set<number>([meta.gameId])
  const pool = [...archive]
    .filter((match) => {
      if (
        !match.digest ||
        match.meta.puuid !== meta.puuid ||
        match.meta.sgpServerId !== meta.sgpServerId ||
        match.meta.position !== meta.position ||
        seen.has(match.meta.gameId)
      )
        return false
      seen.add(match.meta.gameId)
      return true
    })
    .sort((a, b) => b.meta.gameCreation - a.meta.gameCreation || b.meta.gameId - a.meta.gameId)

  const sameChampion = pool.filter((match) => match.meta.championId === meta.championId)
  const scopes: Array<[ReviewBaselineScope, ReviewMatch[]]> = [
    [
      'matchup',
      meta.opponentChampionId === null
        ? []
        : sameChampion.filter((match) => match.meta.opponentChampionId === meta.opponentChampionId)
    ],
    ['champion', sameChampion],
    ['position', pool]
  ]
  for (const [scope, games] of scopes) {
    if (games.length >= REVIEW_BASELINE_MIN_GAMES)
      return buildReviewBaseline(games.slice(0, REVIEW_BASELINE_MAX_GAMES), scope)
  }
  return null
}

export interface ReviewBaselineRow {
  key: ReviewDigestMetricKey
  unit: ReviewMetricUnit
  value: number
  median: number
  q1: number
  q3: number
  samples: number
  /** Share of the baseline games below this value, ties counted half: 0 to 1. */
  percentile: number
  /** Where the value sits against the middle half of the baseline games. */
  band: 'below' | 'typical' | 'above'
  /**
   * The value is beyond at least nine in ten of the baseline games. Half of all values fall
   * outside the middle half by definition, so `band` alone is a lean, not a finding.
   */
  extreme: boolean
  /**
   * Distance from the median in units of the middle half's width, signed. Only for ordering
   * rows by how unusual they are; when the baseline games all share one value the width is
   * replaced by the size of the median itself.
   */
  deviation: number
  /** `band` read through the metric's direction; neutral when the metric has none. */
  verdict: 'better' | 'worse' | 'typical' | 'neutral'
}

/** Share of baseline games a value has to be beyond, on either side, to count as extreme. */
export const REVIEW_BASELINE_EXTREME_SHARE = 0.9

/**
 * This game's numbers against the baseline. A metric appears only when the game has the value
 * and enough baseline games have it too; nothing is compared against a handful of games.
 */
export function compareToReviewBaseline(
  digest: ReviewDigest,
  baseline: ReviewBaseline
): ReviewBaselineRow[] {
  const rows: ReviewBaselineRow[] = []
  for (const key of REVIEW_DIGEST_METRIC_KEYS) {
    const value = digest.metrics[key]
    const metric = baseline.metrics[key]
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      metric.samples < REVIEW_BASELINE_MIN_GAMES ||
      metric.median === null ||
      metric.q1 === null ||
      metric.q3 === null
    )
      continue
    const below = metric.values.filter((other) => other < value).length
    const equal = metric.values.filter((other) => other === value).length
    const band = value < metric.q1 ? 'below' : value > metric.q3 ? 'above' : 'typical'
    const percentile = (below + equal / 2) / metric.samples
    const { unit, better } = REVIEW_DIGEST_METRIC_META[key]
    rows.push({
      key,
      unit,
      value,
      median: metric.median,
      q1: metric.q1,
      q3: metric.q3,
      samples: metric.samples,
      percentile,
      band,
      extreme:
        band !== 'typical' &&
        (percentile >= REVIEW_BASELINE_EXTREME_SHARE ||
          percentile <= 1 - REVIEW_BASELINE_EXTREME_SHARE),
      deviation:
        (value - metric.median) / (metric.q3 - metric.q1 || Math.max(Math.abs(metric.median), 1)),
      verdict:
        band === 'typical'
          ? 'typical'
          : better === null
            ? 'neutral'
            : (band === 'above') === (better === 'higher')
              ? 'better'
              : 'worse'
    })
  }
  return rows
}
