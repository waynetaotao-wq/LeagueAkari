import type {
  ReviewConversionOptions,
  ReviewConversionStats,
  ReviewFilter,
  ReviewMatch,
  ReviewMatchupGroup,
  ReviewMetric,
  ReviewSampleStats,
  ReviewSnapshot,
  ReviewTrend
} from './types'

// [lolps] 门槛是明确的筛选条件，不表示对某一玩家的客观评价。
export const REVIEW_PERSONAL_LEAD_GOLD = 500
export const REVIEW_TEAM_LEAD_GOLD = 1500

function uniqueMatches(matches: ReviewMatch[]): ReviewMatch[] {
  const unique = new Map<string, ReviewMatch>()
  for (const match of matches) {
    const key = `${match.meta.sgpServerId}:${match.meta.gameId}:${match.meta.puuid}`
    if (!unique.has(key)) unique.set(key, match)
  }
  return [...unique.values()]
}

export function filterReviewMatches(
  matches: ReviewMatch[],
  filter: ReviewFilter = {}
): ReviewMatch[] {
  return uniqueMatches(matches).filter(
    ({ meta }) =>
      (filter.championId == null || meta.championId === filter.championId) &&
      (filter.position == null || meta.position === filter.position) &&
      (filter.opponentChampionId == null ||
        meta.opponentChampionId === filter.opponentChampionId) &&
      (filter.patch == null || meta.patch === filter.patch) &&
      (filter.queueId == null || meta.queueId === filter.queueId)
  )
}

function summarizeMetric(values: Array<number | null>): ReviewMetric {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value))
  if (!valid.length)
    return { mean: null, samples: 0, min: null, max: null, standardDeviation: null }
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length
  return {
    mean,
    samples: valid.length,
    min: Math.min(...valid),
    max: Math.max(...valid),
    standardDeviation:
      valid.length < 2
        ? null
        : Math.sqrt(valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (valid.length - 1))
  }
}

export function summarizeReviewMatches(matches: ReviewMatch[]): ReviewSampleStats {
  const unique = uniqueMatches(matches)
  const values = (minute: 10 | 15, key: 'personalGoldDiff' | 'personalCsDiff' | 'teamGoldDiff') =>
    unique.map(
      (match) => match.snapshots.find((snapshot) => snapshot.minute === minute)?.[key] ?? null
    )
  const wins = unique.filter((match) => match.meta.win).length
  return {
    games: unique.length,
    wins,
    winRate: unique.length ? wins / unique.length : null,
    gold10: summarizeMetric(values(10, 'personalGoldDiff')),
    gold15: summarizeMetric(values(15, 'personalGoldDiff')),
    cs10: summarizeMetric(values(10, 'personalCsDiff')),
    cs15: summarizeMetric(values(15, 'personalCsDiff')),
    teamGold10: summarizeMetric(values(10, 'teamGoldDiff')),
    teamGold15: summarizeMetric(values(15, 'teamGoldDiff'))
  }
}

export function groupReviewMatchups(matches: ReviewMatch[]): ReviewMatchupGroup[] {
  const groups = new Map<string, ReviewMatch[]>()
  for (const match of uniqueMatches(matches)) {
    const { championId, position, opponentChampionId } = match.meta
    const key = `${championId}:${position}:${opponentChampionId ?? 'unknown'}`
    const group = groups.get(key) ?? []
    group.push(match)
    groups.set(key, group)
  }
  return [...groups.values()]
    .map((group) => ({
      championId: group[0].meta.championId,
      position: group[0].meta.position,
      opponentChampionId: group[0].meta.opponentChampionId,
      ...summarizeReviewMatches(group),
      matches: group.sort(
        (a, b) => b.meta.gameCreation - a.meta.gameCreation || b.meta.gameId - a.meta.gameId
      )
    }))
    .sort(
      (a, b) =>
        b.games - a.games ||
        a.championId - b.championId ||
        (a.opponentChampionId ?? -1) - (b.opponentChampionId ?? -1)
    )
}

export function buildReviewTrend(matches: ReviewMatch[], limit = 20): ReviewTrend {
  const ordered = uniqueMatches(matches).sort(
    (a, b) => b.meta.gameCreation - a.meta.gameCreation || b.meta.gameId - a.meta.gameId
  )
  const requested = Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.floor(limit))) : 20
  const count = Math.min(requested, Math.floor(ordered.length / 2))
  const recentMatches = ordered.slice(0, count)
  const previousMatches = ordered.slice(count, count * 2)
  return {
    recent: summarizeReviewMatches(recentMatches),
    previous: summarizeReviewMatches(previousMatches),
    recentMatches,
    previousMatches
  }
}

export function analyzeLeadConversion(
  matches: ReviewMatch[],
  options: ReviewConversionOptions = {}
): ReviewConversionStats {
  const checkpoint = options.checkpoint ?? 'either'
  const scope = options.scope ?? 'either'
  const outcome = options.outcome ?? 'all'
  const unique = uniqueMatches(matches)
  let eligibleGames = 0
  const entries: ReviewConversionStats['entries'] = []
  for (const match of unique) {
    const snapshots = match.snapshots
      .filter(
        (snapshot) =>
          (snapshot.minute === 10 || snapshot.minute === 15) &&
          (checkpoint === 'either' || snapshot.minute === checkpoint)
      )
      .sort((a, b) => a.minute - b.minute)
    const usable = (snapshot: ReviewSnapshot) =>
      snapshot.timestamp !== null &&
      ((scope !== 'team' && snapshot.personalGoldDiff !== null) ||
        (scope !== 'personal' && snapshot.teamGoldDiff !== null))
    if (!snapshots.some(usable)) continue
    eligibleGames++
    const qualified = snapshots.find(
      (snapshot) =>
        usable(snapshot) &&
        ((scope !== 'team' &&
          snapshot.personalGoldDiff !== null &&
          snapshot.personalGoldDiff >= REVIEW_PERSONAL_LEAD_GOLD) ||
          (scope !== 'personal' &&
            snapshot.teamGoldDiff !== null &&
            snapshot.teamGoldDiff >= REVIEW_TEAM_LEAD_GOLD))
    )
    if (
      !qualified ||
      (outcome === 'win' && !match.meta.win) ||
      (outcome === 'loss' && match.meta.win)
    )
      continue
    const since = qualified.timestamp!
    entries.push({
      match,
      checkpoint: qualified.minute as 10 | 15,
      personalLead:
        qualified.personalGoldDiff !== null &&
        qualified.personalGoldDiff >= REVIEW_PERSONAL_LEAD_GOLD,
      teamLead: qualified.teamGoldDiff !== null && qualified.teamGoldDiff >= REVIEW_TEAM_LEAD_GOLD,
      snapshots: match.snapshots.filter((snapshot) => snapshot.minute >= qualified.minute),
      deaths: match.events.filter(
        (event) =>
          event.type === 'kill' &&
          event.victimId === match.meta.participantId &&
          event.timestamp > since
      ),
      enemyObjectives: match.events.filter(
        (event) =>
          event.type !== 'kill' &&
          event.teamId !== null &&
          event.teamId !== match.meta.teamId &&
          event.timestamp > since
      )
    })
  }
  entries.sort(
    (a, b) =>
      b.match.meta.gameCreation - a.match.meta.gameCreation ||
      b.match.meta.gameId - a.match.meta.gameId
  )
  const wins = entries.filter(({ match }) => match.meta.win).length
  return {
    games: entries.length,
    wins,
    winRate: entries.length ? wins / entries.length : null,
    eligibleGames,
    excludedGames: unique.length - eligibleGames,
    entries
  }
}
