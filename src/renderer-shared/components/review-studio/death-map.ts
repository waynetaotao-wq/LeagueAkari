import {
  getMapDomain,
  mapToImagePosition
} from '@renderer-shared/components/match-card/utils/game-map'

import type { ReviewDeathSource, ReviewMatch, ReviewPoint } from './types'

// [lolps] 区域划分是为复盘设的展示规则，用防御塔、龙坑和野怪营地的真实坐标校对过，
// 不是游戏内的官方分区；边界附近的点可能落在相邻区域。
const MAP = getMapDomain(11)
/** 河道沿 x + y ≈ 此值延伸，同时也是三条兵线的中点。 */
const CENTRE_SUM = (MAP.maxX + MAP.maxY) / 2
const BASE_RADIUS = 5400
const LANE_EDGE = 2200
const MID_HALF_WIDTH = 1400
const RIVER_HALF_WIDTH = 1300

export const REVIEW_DEATH_ZONES = [
  'mid-own',
  'mid-enemy',
  'top-own',
  'top-enemy',
  'bot-own',
  'bot-enemy',
  'river-top',
  'river-bot',
  'jungle-own-top',
  'jungle-own-bot',
  'jungle-enemy-top',
  'jungle-enemy-bot',
  'own-base',
  'enemy-base'
] as const
export type ReviewDeathZone = (typeof REVIEW_DEATH_ZONES)[number]

/** Classifies a point relative to the player's own side, so both map sides can be combined. */
export function classifyReviewDeathZone(point: ReviewPoint, teamId: 100 | 200): ReviewDeathZone {
  const { x, y } = point
  const inBlueBase = Math.hypot(x, y) < BASE_RADIUS
  if (inBlueBase || Math.hypot(MAP.maxX - x, MAP.maxY - y) < BASE_RADIUS)
    return (inBlueBase ? 100 : 200) === teamId ? 'own-base' : 'enemy-base'
  const sum = x + y
  const half = (teamId === 100 ? sum > CENTRE_SUM : sum < CENTRE_SUM) ? 'enemy' : 'own'
  if (x < LANE_EDGE || y > MAP.maxY - LANE_EDGE) return `top-${half}`
  if (y < LANE_EDGE || x > MAP.maxX - LANE_EDGE) return `bot-${half}`
  if (Math.abs(x - y) <= MID_HALF_WIDTH) return `mid-${half}`
  const side = y > x ? 'top' : 'bot'
  if (Math.abs(sum - CENTRE_SUM) <= RIVER_HALF_WIDTH) return `river-${side}`
  return `jungle-${half}-${side}`
}

export type ReviewDeathKind = 'solo' | 'group' | 'execute'

export interface ReviewDeathEntry {
  key: string
  gameId: number
  gameCreation: number
  win: boolean
  teamId: 100 | 200
  championId: number
  opponentChampionId: number | null
  timestamp: number
  point: ReviewPoint | null
  zone: ReviewDeathZone | null
  kind: ReviewDeathKind
  /** Whether the enemy jungler was credited; null when a credited enemy's role is unknown. */
  jungle: boolean | null
  killer: ReviewDeathSource | null
  assists: ReviewDeathSource[]
  shutdownBounty: number | null
}

export interface ReviewDeathGame {
  gameId: number
  win: boolean
  teamId: 100 | 200
  durationMs: number
}

export interface ReviewDeathSample {
  /** Games whose kill records reconcile with the summary; only these are counted. */
  games: ReviewDeathGame[]
  entries: ReviewDeathEntry[]
  /** Archived before death coordinates were kept. */
  legacyGames: number
  /** Kill records could not be reconciled, so counts would be a lower bound. */
  partialGames: number
}

export function collectReviewDeaths(matches: ReviewMatch[]): ReviewDeathSample {
  const sample: ReviewDeathSample = { games: [], entries: [], legacyGames: 0, partialGames: 0 }
  const seen = new Set<string>()
  for (const match of matches) {
    const { meta } = match
    const id = `${meta.sgpServerId}:${meta.gameId}:${meta.puuid}`
    if (seen.has(id)) continue
    seen.add(id)
    if (!Array.isArray(match.deaths)) {
      sample.legacyGames++
      continue
    }
    if (match.quality.eventCoverage !== 'complete') {
      sample.partialGames++
      continue
    }
    sample.games.push({
      gameId: meta.gameId,
      win: meta.win,
      teamId: meta.teamId,
      durationMs: meta.gameDuration * 1000
    })
    match.deaths.forEach((death, index) => {
      const sources = [death.killer, ...death.assists].filter(
        (source): source is ReviewDeathSource => source !== null
      )
      sample.entries.push({
        key: `${id}:${index}`,
        gameId: meta.gameId,
        gameCreation: meta.gameCreation,
        win: meta.win,
        teamId: meta.teamId,
        championId: meta.championId,
        opponentChampionId: meta.opponentChampionId,
        timestamp: death.timestamp,
        point: death.point,
        zone: death.point ? classifyReviewDeathZone(death.point, meta.teamId) : null,
        kind: death.killer === null ? 'execute' : death.assists.length ? 'group' : 'solo',
        jungle: sources.some((source) => source.role === 'JUNGLE')
          ? true
          : sources.some((source) => source.role === 'UNKNOWN')
            ? null
            : false,
        killer: death.killer,
        assists: death.assists,
        shutdownBounty: death.shutdownBounty
      })
    })
  }
  sample.entries.sort(
    (a, b) => b.gameCreation - a.gameCreation || b.gameId - a.gameId || a.timestamp - b.timestamp
  )
  return sample
}

export interface ReviewDeathFilter {
  fromMs: number
  /** Exclusive; Infinity keeps every death until the game ends. */
  toMs: number
  outcome: 'all' | 'win' | 'loss'
  kind: 'all' | 'solo' | 'group' | 'jungle'
  side: 'all' | 'blue' | 'red'
}

export const REVIEW_DEATH_BUCKET_MS = 2 * 60_000
/** Twenty 2-minute buckets; the last one also holds everything after 40 minutes. */
export const REVIEW_DEATH_BUCKETS = 21
export const REVIEW_HOTSPOT_MIN_DEATHS = 5
export const REVIEW_HOTSPOT_MIN_GAMES = 3
export const REVIEW_HOTSPOT_MIN_SHARE = 0.25

export interface ReviewDeathZoneStat {
  zone: ReviewDeathZone
  deaths: number
  /** Share of the located deaths in the current selection. */
  share: number
  games: number
}

export interface ReviewDeathSummary {
  /** Games matching result and side that lasted long enough to reach the selected window. */
  games: number
  deaths: number
  perGame: number | null
  located: number
  solo: number
  group: number
  execute: number
  jungle: number
  /** Deaths whose credited enemies all have a known role. */
  jungleKnown: number
  zones: ReviewDeathZoneStat[]
  /** A zone concentrated enough to be worth naming; null when deaths are spread out or too few. */
  hotspot: ReviewDeathZoneStat | null
  /** Deaths per 2-minute bucket across the whole game, ignoring the selected time window. */
  timeline: number[]
}

export function summarizeReviewDeaths(
  sample: ReviewDeathSample,
  filter: ReviewDeathFilter
): { entries: ReviewDeathEntry[]; summary: ReviewDeathSummary } {
  const matchesGame = (game: { win: boolean; teamId: 100 | 200 }) =>
    (filter.outcome === 'all' || game.win === (filter.outcome === 'win')) &&
    (filter.side === 'all' || game.teamId === (filter.side === 'blue' ? 100 : 200))
  const matchesKind = (entry: ReviewDeathEntry) =>
    filter.kind === 'all' ||
    (filter.kind === 'jungle' ? entry.jungle === true : entry.kind === filter.kind)
  const scoped = sample.entries.filter((entry) => matchesGame(entry) && matchesKind(entry))
  const timeline = Array.from({ length: REVIEW_DEATH_BUCKETS }, () => 0)
  for (const entry of scoped)
    timeline[
      Math.min(REVIEW_DEATH_BUCKETS - 1, Math.floor(entry.timestamp / REVIEW_DEATH_BUCKET_MS))
    ]++
  const entries = scoped.filter(
    (entry) => entry.timestamp >= filter.fromMs && entry.timestamp < filter.toMs
  )
  const games = sample.games.filter(
    (game) => matchesGame(game) && game.durationMs > filter.fromMs
  ).length
  const located = entries.filter((entry) => entry.zone !== null)
  const byZone = new Map<ReviewDeathZone, { deaths: number; games: Set<number> }>()
  for (const entry of located) {
    const stat = byZone.get(entry.zone!) ?? { deaths: 0, games: new Set<number>() }
    stat.deaths++
    stat.games.add(entry.gameId)
    byZone.set(entry.zone!, stat)
  }
  const zones = [...byZone]
    .map(([zone, stat]) => ({
      zone,
      deaths: stat.deaths,
      share: stat.deaths / located.length,
      games: stat.games.size
    }))
    .sort(
      (a, b) =>
        b.deaths - a.deaths ||
        b.games - a.games ||
        REVIEW_DEATH_ZONES.indexOf(a.zone) - REVIEW_DEATH_ZONES.indexOf(b.zone)
    )
  const top = zones[0]
  return {
    entries,
    summary: {
      games,
      deaths: entries.length,
      perGame: games ? entries.length / games : null,
      located: located.length,
      solo: entries.filter((entry) => entry.kind === 'solo').length,
      group: entries.filter((entry) => entry.kind === 'group').length,
      execute: entries.filter((entry) => entry.kind === 'execute').length,
      jungle: entries.filter((entry) => entry.jungle === true).length,
      jungleKnown: entries.filter((entry) => entry.jungle !== null).length,
      zones,
      hotspot:
        top &&
        top.deaths >= REVIEW_HOTSPOT_MIN_DEATHS &&
        top.games >= REVIEW_HOTSPOT_MIN_GAMES &&
        top.share >= REVIEW_HOTSPOT_MIN_SHARE
          ? top
          : null,
      timeline
    }
  }
}

/**
 * Density of the given points on a size×size grid in image orientation (row 0 is the top of the
 * map), normalised to 0–1. Purely a drawing aid: it smooths points, it does not estimate risk.
 */
export function buildReviewDeathHeat(points: ReviewPoint[], size = 64, sigma = 2): Float32Array {
  const grid = new Float32Array(size * size)
  const reach = Math.ceil(sigma * 3)
  for (const point of points) {
    const { left, top } = mapToImagePosition(point.x, point.y, size, size, 11)
    const column = Math.min(size - 1, Math.floor(left))
    const row = Math.min(size - 1, Math.floor(top))
    for (let y = Math.max(0, row - reach); y <= Math.min(size - 1, row + reach); y++) {
      for (let x = Math.max(0, column - reach); x <= Math.min(size - 1, column + reach); x++) {
        const distance = (x + 0.5 - left) ** 2 + (y + 0.5 - top) ** 2
        grid[y * size + x] += Math.exp(-distance / (2 * sigma * sigma))
      }
    }
  }
  let max = 0
  for (const value of grid) if (value > max) max = value
  if (max > 0) for (let index = 0; index < grid.length; index++) grid[index] /= max
  return grid
}
