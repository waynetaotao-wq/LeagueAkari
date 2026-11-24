import type {
  ChampionDataDetails,
  ChampionRecommendationPerformance
} from '@shared/data-adapter/champion-data'
import type { MatchupBuildResult } from '@shared/types/counter-intel'

import type { ReviewMatch, ReviewPosition } from './types'

// [lolps] 符文、召唤师技能、出装的两种旁证：
// 一是同段位的统计（OP.GG：别人怎么带、胜率多少），二是本人自己以往怎么带、结果如何。
// 两者都只说明「相关」，不说明因果；样本数原样带上，让读的人自己掂量。

/** 统计里每一类最多取这么多行；再往后的使用率太低，只会占篇幅。 */
export const REVIEW_STATISTICS_ROWS = {
  runePages: 6,
  spells: 4,
  starting: 3,
  boots: 3,
  core: 5,
  // 单件装备取得多一些：防御装和针对性的装备使用率低，排在后面，少取就看不到了。
  late: 16
} as const
/** 只看这个对位的那一份样本小得多，行数也少取。 */
export const REVIEW_STATISTICS_VERSUS_ROWS = {
  runePages: 3,
  spells: 3,
  starting: 2,
  boots: 2,
  core: 3,
  late: 8
} as const
/**
 * 不到这么多局的行不要：几局十几局的胜率没有意义。只看一个对位时样本本来就小；打一个不常见
 * 的位置时（实测：一个中单英雄去上路），通用的表里也会出现二三十局的行。
 */
export const REVIEW_STATISTICS_MIN_GAMES = 30

export interface ReviewLoadoutSample {
  games: number
  wins: number
  /** Share of the champion's games that used it, 0 to 1; null when the source does not say. */
  pickRate: number | null
}

export interface ReviewLoadoutOption extends ReviewLoadoutSample {
  ids: number[]
}

export interface ReviewRunePageOption extends ReviewLoadoutSample {
  primaryStyle: number
  secondaryStyle: number
  /** Keystone first. */
  primary: number[]
  secondary: number[]
  shards: number[]
  /**
   * The numbers count every page with this keystone and this secondary tree, and the runes are
   * only the most common page among them. The matchup-only answer comes this way; absent for an
   * exact page. Checked on real answers: all pages of a row share the keystone and both trees,
   * and no two rows share keystone and secondary tree.
   */
  groupTotal?: boolean
}

export interface ReviewLoadoutTable {
  runePages: ReviewRunePageOption[]
  spells: ReviewLoadoutOption[]
  starting: ReviewLoadoutOption[]
  boots: ReviewLoadoutOption[]
  /** The usual first three completed items. */
  core: ReviewLoadoutOption[]
  /** Single items by how many games held them, whatever their place in the build. */
  late: ReviewLoadoutOption[]
}

export interface ReviewLoadoutStatistics {
  region: string
  tier: string
  /** The patch the numbers are from; null when the source does not say. */
  patch: string | null
  /** The numbers are from the patch the reviewed game was played on. */
  samePatch: boolean
  champion: { games: number | null; winRate: number | null; pickRate: number | null }
  /** This champion against the lane opponent; null when the source lists no such games. */
  matchup: { games: number; wins: number } | null
  general: ReviewLoadoutTable
  /** The same tables from games against this lane opponent only; null when there are too few. */
  versus: ReviewLoadoutTable | null
}

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
const idList = (value: unknown, length?: number): number[] | null =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(positive) &&
  (!length || value.length === length)
    ? [...value]
    : null

function sample(games: unknown, wins: unknown, pickRate: unknown): ReviewLoadoutSample | null {
  if (
    !positive(games) ||
    typeof wins !== 'number' ||
    !Number.isFinite(wins) ||
    wins < 0 ||
    wins > games
  )
    return null
  return {
    games,
    wins,
    pickRate:
      typeof pickRate === 'number' && Number.isFinite(pickRate) && pickRate >= 0 && pickRate <= 1
        ? pickRate
        : null
  }
}
const fromPerformance = (performance: ChampionRecommendationPerformance | undefined) =>
  sample(performance?.games, performance?.wins, performance?.pickRate)

const byGames = <T extends ReviewLoadoutSample>(rows: T[], limit: number) =>
  rows
    .filter((row) => row.games >= REVIEW_STATISTICS_MIN_GAMES)
    .sort((a, b) => b.games - a.games)
    .slice(0, limit)

/** `16.01` and `16.1` are the same patch. */
export function normalizeReviewPatch(patch: string | null | undefined): string | null {
  const match = /^(\d+)\.(\d+)/.exec(typeof patch === 'string' ? patch.trim() : '')
  return match ? `${Number(match[1])}.${Number(match[2])}` : null
}

/**
 * The patch to ask the statistics source for: the game's own patch when the source has it,
 * otherwise the newest one. null when the source lists no patch at all.
 */
export function selectReviewStatisticsPatch(
  available: readonly string[],
  gamePatch: string
): { patch: string; samePatch: boolean } | null {
  const usable = available.filter((patch) => normalizeReviewPatch(patch) !== null)
  if (!usable.length) return null
  const wanted = normalizeReviewPatch(gamePatch)
  const same = usable.find((patch) => normalizeReviewPatch(patch) === wanted)
  return same ? { patch: same, samePatch: true } : { patch: usable[0], samePatch: false }
}

export const REVIEW_STATISTICS_POSITION: Partial<
  Record<ReviewPosition, 'top' | 'jungle' | 'middle' | 'bottom' | 'utility'>
> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MIDDLE: 'middle',
  BOTTOM: 'bottom',
  UTILITY: 'utility'
}

/** The general tables of one champion in one role. null when the answer is about something else. */
export function readReviewChampionStatistics(
  details: ChampionDataDetails,
  expected: { championId: number; position: string; opponentChampionId: number | null }
): Pick<ReviewLoadoutStatistics, 'champion' | 'matchup' | 'general'> | null {
  if (
    details?.metadata?.source !== 'opgg' ||
    details.championId !== expected.championId ||
    details.summary?.position !== expected.position
  )
    return null
  const { sections } = details
  const slot = (name: string, limit: number) =>
    byGames(
      (sections.itemBuilds?.find((entry) => entry.slot === name)?.options ?? []).flatMap(
        (option) => {
          const ids = idList(option?.itemIds)
          const stats = fromPerformance(option?.performance)
          return ids && stats ? [{ ids, ...stats }] : []
        }
      ),
      limit
    )
  const versus = sections.matchups?.find((row) => row.championId === expected.opponentChampionId)
  const versusSample = fromPerformance(versus?.performance)
  const performance = details.summary.performance
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : null

  return {
    champion: {
      games: number(performance?.games),
      winRate: number(performance?.winRate),
      pickRate: number(performance?.pickRate)
    },
    matchup: versusSample ? { games: versusSample.games, wins: versusSample.wins } : null,
    general: {
      runePages: byGames(
        (sections.runePages ?? []).flatMap((page) => {
          const primary = idList(page?.primaryRuneIds, 4)
          const secondary = idList(page?.secondaryRuneIds, 2)
          const stats = fromPerformance(page?.performance)
          return positive(page?.primaryStyleId) &&
            positive(page?.secondaryStyleId) &&
            primary &&
            secondary &&
            stats
            ? [
                {
                  primaryStyle: page.primaryStyleId,
                  secondaryStyle: page.secondaryStyleId,
                  primary,
                  secondary,
                  shards: idList(page.statShardIds) ?? [],
                  ...stats
                }
              ]
            : []
        }),
        REVIEW_STATISTICS_ROWS.runePages
      ),
      spells: byGames(
        (sections.summonerSpells ?? []).flatMap((row) => {
          const ids = idList(row?.spellIds, 2)
          const stats = fromPerformance(row?.performance)
          return ids && stats ? [{ ids, ...stats }] : []
        }),
        REVIEW_STATISTICS_ROWS.spells
      ),
      starting: slot('starting', REVIEW_STATISTICS_ROWS.starting),
      boots: slot('boots', REVIEW_STATISTICS_ROWS.boots),
      core: slot('core', REVIEW_STATISTICS_ROWS.core),
      late: slot('last', REVIEW_STATISTICS_ROWS.late)
    }
  }
}

/**
 * The matchup-only tables. The main process hands them over only after it has checked that the
 * source really answered for this opponent; anything else gives null.
 */
export function readReviewMatchupStatistics(
  result: MatchupBuildResult | null | undefined,
  expected: { championId: number; opponentChampionId: number }
): ReviewLoadoutTable | null {
  if (
    !result?.targetVerified ||
    !result.overlay ||
    result.myChampionId !== expected.championId ||
    result.opponentChampionId !== expected.opponentChampionId
  )
    return null
  const rows = (key: string) => {
    const value = result.overlay![key]
    return Array.isArray(value) ? (value as Array<Record<string, unknown> | null>) : []
  }
  const options = (key: string, limit: number, length?: number) =>
    byGames(
      rows(key).flatMap((row) => {
        const ids = idList(row?.ids, length)
        const stats = sample(row?.play, row?.win, row?.pick_rate)
        return ids && stats ? [{ ids, ...stats }] : []
      }),
      limit
    )
  const limits = REVIEW_STATISTICS_VERSUS_ROWS
  const table: ReviewLoadoutTable = {
    runePages: byGames(
      rows('runes').flatMap((row) => {
        const primary = idList(row?.primary_rune_ids, 4)
        const secondary = idList(row?.secondary_rune_ids, 2)
        const stats = sample(row?.play, row?.win, row?.pick_rate)
        const primaryStyle = row?.primary_page_id
        const secondaryStyle = row?.secondary_page_id
        return positive(primaryStyle) && positive(secondaryStyle) && primary && secondary && stats
          ? [
              {
                primaryStyle,
                secondaryStyle,
                primary,
                secondary,
                shards: idList(row?.stat_mod_ids) ?? [],
                ...stats,
                // 主进程按网页的主卡给：数字是「这个基石配这个副系」的全部带法，符文是其中最常见的一页。
                ...(row?.is_group_total === true ? { groupTotal: true } : {})
              }
            ]
          : []
      }),
      limits.runePages
    ),
    spells: options('summoner_spells', limits.spells, 2),
    starting: options('starter_items', limits.starting),
    boots: options('boots', limits.boots),
    core: options('core_items', limits.core),
    late: options('last_items', limits.late)
  }
  return Object.values(table).some((list) => list.length) ? table : null
}

// ── 本人以往怎么带 ──────────────────────────────────────────────────────

export interface ReviewLoadoutRecord {
  /** Rune, pair of spells or item ids the games share. */
  ids: number[]
  games: number
  wins: number
}

export interface ReviewLoadoutHistoryGroup {
  games: number
  wins: number
  keystones: ReviewLoadoutRecord[]
  /** Whole pages of six runes, keystone first; only from games archived with their runes. */
  pages: ReviewLoadoutRecord[]
  spells: ReviewLoadoutRecord[]
  /** First completed item. */
  firstItems: ReviewLoadoutRecord[]
  /** The first three completed items in order; only from games that finished three. */
  corePaths: ReviewLoadoutRecord[]
}

/** What one rune recorded in the same player's other games on this champion and role. */
export interface ReviewRuneHistory {
  id: number
  /** One entry per game that took this rune and was archived with its numbers. */
  samples: Array<{ stats: number[]; duration: number }>
}

export interface ReviewLoadoutHistory {
  /** The same player's other games on the same champion in the same role. */
  champion: ReviewLoadoutHistoryGroup
  /** The part of them played against the same lane opponent; null without such games. */
  matchup: ReviewLoadoutHistoryGroup | null
  /** For each rune of the reviewed game, in page order: its record in those other games. */
  runes: ReviewRuneHistory[]
}

/** 历史里每一类最多列这么多种带法，再往后都是只打过一两局的。 */
export const REVIEW_HISTORY_ROWS = 4
/** 一页符文：主系的基石加三颗，再加副系两颗。 */
export const REVIEW_PRIMARY_RUNES = 4
export const REVIEW_RUNE_PAGE_SIZE = 6

function tally(matches: readonly ReviewMatch[]): ReviewLoadoutHistoryGroup {
  const group = (pick: (match: ReviewMatch) => number[] | null) => {
    const records = new Map<string, ReviewLoadoutRecord>()
    for (const match of matches) {
      const ids = pick(match)
      if (!ids?.length) continue
      const key = ids.join('+')
      const record = records.get(key) ?? { ids, games: 0, wins: 0 }
      record.games++
      if (match.meta.win) record.wins++
      records.set(key, record)
    }
    return [...records.values()]
      .sort((a, b) => b.games - a.games || b.wins - a.wins)
      .slice(0, REVIEW_HISTORY_ROWS)
  }
  return {
    games: matches.length,
    wins: matches.filter((match) => match.meta.win).length,
    keystones: group((match) => (match.digest?.keystone ? [match.digest.keystone] : null)),
    // 主系四颗的先后就是基石和三行的先后；副系的两颗没有先后，同样的两颗换个顺序选是同一页。
    pages: group((match) => {
      const ids = match.digest?.runes?.map((rune) => rune[0])
      return ids?.length === REVIEW_RUNE_PAGE_SIZE
        ? [
            ...ids.slice(0, REVIEW_PRIMARY_RUNES),
            ...ids.slice(REVIEW_PRIMARY_RUNES).sort((a, b) => a - b)
          ]
        : null
    }),
    // 两个召唤师技能放在 D 还是 F 不算不同的带法。
    spells: group((match) =>
      match.digest?.summonerSpells.length === 2
        ? [...match.digest.summonerSpells].sort((a, b) => a - b)
        : null
    ),
    firstItems: group((match) =>
      match.digest?.coreItems.length ? [match.digest.coreItems[0].itemId] : null
    ),
    corePaths: group((match) =>
      match.digest?.coreItems.length === 3
        ? match.digest.coreItems.map((item) => item.itemId)
        : null
    )
  }
}

/**
 * How the same player set up this champion in this role in their other archived games, and how
 * those games went. null when the archive has no such game.
 */
export function summarizeReviewLoadoutHistory(
  target: ReviewMatch,
  archive: readonly ReviewMatch[]
): ReviewLoadoutHistory | null {
  const { meta } = target
  if (meta.position === 'UNKNOWN') return null
  const seen = new Set<number>([meta.gameId])
  const games = archive.filter((match) => {
    if (
      !match.digest ||
      match.meta.puuid !== meta.puuid ||
      match.meta.sgpServerId !== meta.sgpServerId ||
      match.meta.position !== meta.position ||
      match.meta.championId !== meta.championId ||
      seen.has(match.meta.gameId)
    )
      return false
    seen.add(match.meta.gameId)
    return true
  })
  if (!games.length) return null
  const versus =
    meta.opponentChampionId === null
      ? []
      : games.filter((match) => match.meta.opponentChampionId === meta.opponentChampionId)
  // 这一局带的每颗符文，在别的对局里记下的数：用来判断这一局的数算多还是算少。
  const taken = target.digest?.runes?.map((rune) => rune[0]) ?? []
  const runes = taken.map((id) => ({
    id,
    samples: games.flatMap((match) => {
      const entry = match.digest?.runes?.find((rune) => rune[0] === id)
      return entry ? [{ stats: entry.slice(1), duration: match.meta.gameDuration }] : []
    })
  }))
  return { champion: tally(games), matchup: versus.length ? tally(versus) : null, runes }
}
