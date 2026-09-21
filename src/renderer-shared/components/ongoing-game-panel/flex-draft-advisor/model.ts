import type { OngoingGameProviderValue } from '@renderer-shared/providers/ongoing-game/types'
import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import type { ChampSelectSession, ChampSelectTeam } from '@shared/types/league-client/champ-select'

export const DRAFT_ROLES = ['top', 'jungle', 'middle', 'bottom', 'utility'] as const
export type DraftRole = (typeof DRAFT_ROLES)[number]
export const MAX_CANDIDATES = 10
const DAY = 86_400_000
// LCU identifies 积分对战 五排 as RANKED_PREMADE_5x5 (710), separate from Ranked Flex (440).
const PREMADE_FIVE_QUEUE_ID = 710
const CLASH_QUEUE_ID = 700
export type DraftQueueId = typeof PREMADE_FIVE_QUEUE_ID | typeof CLASH_QUEUE_ID

export interface PoolChampion {
  championId: number
  games: number
  wins: number
}

export interface DraftPlayer {
  puuid: string
  name: string
  cellId: number
  position: DraftRole | null
  lockedChampionId: number
  hoverChampionId: number
}

export interface DraftContext {
  key: string
  queueId: DraftQueueId
  self: DraftPlayer
  allies: DraftPlayer[]
  enemies: DraftPlayer[]
  banned: Set<number>
  locked: Set<number>
  allyIntents: Set<number>
  banFinished: boolean
}

export interface PlayerHistory {
  games: number
  champions: PoolChampion[]
  roles: Partial<Record<DraftRole, number>>
  byRole: Partial<Record<DraftRole, PoolChampion[]>>
  unknownRoleGames: number
}

export interface TargetPool {
  source: 'manual' | 'client' | 'history' | 'unresolved'
  players: Array<{ player: DraftPlayer; weight: number }>
  champions: Array<{ championId: number; weight: number }>
  unknownRole: boolean
}

export interface MatchupSample {
  championId: number
  games: number
  wins: number
}

export interface PickAdvice extends PoolChampion {
  score: number | null
  outlook: 'favorable' | 'even' | 'unfavorable' | 'unknown'
  coverage: number
  favorableCoverage: number
  rows: Array<{
    championId: number
    weight: number
    games: number | null
    winRate: number | null
  }>
  worst: { championId: number; winRate: number } | null
}

export interface BanAdvice extends PoolChampion {
  player: DraftPlayer
  otherPlayers: DraftPlayer[]
  poolGames: number
  score: number
}

export function draftRole(value?: string | null): DraftRole | null {
  const normalized = value?.toLowerCase()
  if (normalized === 'mid') return 'middle'
  if (normalized === 'adc' || normalized === 'bot') return 'bottom'
  if (normalized === 'support') return 'utility'
  return DRAFT_ROLES.includes(normalized as DraftRole) ? (normalized as DraftRole) : null
}

function visibleMember(member: ChampSelectTeam) {
  // Never use obfuscated identities or another feature's deobfuscation results here.
  return (
    member.nameVisibilityType !== 'HIDDEN' &&
    Boolean(member.puuid && !/^0+(?:-0+)*$/.test(member.puuid)) &&
    Boolean(member.gameName?.trim())
  )
}

export function getDraftContext(
  game: Pick<
    OngoingGameProviderValue,
    'settings' | 'queryStage' | 'draft' | 'isConnected' | 'isSpectating' | 'selfPuuid'
  >,
  session: ChampSelectSession | null
): DraftContext | null {
  if (
    !game.settings.enabled ||
    !game.isConnected ||
    game.isSpectating ||
    game.draft ||
    game.queryStage.phase !== 'champ-select' ||
    ![PREMADE_FIVE_QUEUE_ID, CLASH_QUEUE_ID].includes(game.queryStage.gameInfo.queueId) ||
    game.queryStage.gameInfo.gameMode !== 'CLASSIC' ||
    !session ||
    // Gameflow is authoritative; some LCU versions omit queueId on the selection session.
    (session.queueId > 0 && session.queueId !== game.queryStage.gameInfo.queueId) ||
    session.isSpectating ||
    session.isCustomGame ||
    session.myTeam.length !== 5 ||
    session.theirTeam.length !== 5 ||
    (session.gameId > 0 &&
      game.queryStage.gameInfo.gameId > 0 &&
      session.gameId !== game.queryStage.gameInfo.gameId)
  )
    return null

  const self = session.myTeam.find(
    (member) => member.puuid === game.selfPuuid && member.cellId === session.localPlayerCellId
  )
  if (!self || !visibleMember(self)) return null
  const actions = session.actions.flat()
  const lockedCells = new Set(
    actions
      .filter((action) => action.type === 'pick' && action.completed)
      .map((action) => action.actorCellId)
  )
  const player = (member: ChampSelectTeam): DraftPlayer => ({
    puuid: member.puuid,
    name: member.gameName,
    cellId: member.cellId,
    position: draftRole(member.assignedPosition),
    // The member's current champion reflects trades; the original completed action does not.
    lockedChampionId: lockedCells.has(member.cellId) ? member.championId : 0,
    hoverChampionId: member.championPickIntent || member.championId || 0
  })
  const allies = session.myTeam.filter(visibleMember).map(player)
  const enemies = session.theirTeam.filter(visibleMember).map(player)
  if (!enemies.length) return null
  const roster = [...session.myTeam, ...session.theirTeam]
  const bans = actions.filter((action) => action.type === 'ban')
  const queueId = game.queryStage.gameInfo.queueId as DraftQueueId
  return {
    // Identities arrive incrementally within one session; they must not reset manual choices.
    key: `${queueId}:${session.id || session.gameId}:${self.puuid}`,
    queueId,
    self: player(self),
    allies,
    enemies,
    banned: new Set(
      [
        ...session.bans.myTeamBans,
        ...session.bans.theirTeamBans,
        ...bans.filter((action) => action.completed).map((action) => action.championId)
      ].filter((id) => id > 0)
    ),
    locked: new Set(
      roster
        .filter((m) => lockedCells.has(m.cellId))
        .map((m) => m.championId)
        .filter((id) => id > 0)
    ),
    allyIntents: new Set(
      session.myTeam
        .filter((m) => m.puuid !== self.puuid)
        .map((m) => m.championPickIntent || m.championId)
        .filter((id) => id > 0)
    ),
    // Clash has two ban rounds. Six completed first-round bans do not finish all banning,
    // including when the client has not yet supplied the second round's actions.
    banFinished:
      bans.length >= (queueId === CLASH_QUEUE_ID ? 10 : 1) &&
      bans.every((action) => action.completed)
  }
}

/** Only the selected queue's valid, recent games. A missing identity/result is not a loss. */
export function readPlayerHistory(
  puuid: string,
  history: LcuOrSgpGameSummary[] = [],
  now = Date.now(),
  queueId: DraftQueueId = PREMADE_FIVE_QUEUE_ID
): PlayerHistory {
  const records: Array<{
    gameId: number
    created: number
    championId: number
    win: boolean
    role: DraftRole | null
  }> = []
  for (const entry of history) {
    const game = entry.source === 'sgp' ? entry.data.json : entry.data
    if (
      !game ||
      game.queueId !== queueId ||
      game.mapId !== 11 ||
      game.gameMode !== 'CLASSIC' ||
      !Number.isFinite(game.gameCreation) ||
      game.gameCreation < now - 90 * DAY ||
      game.gameCreation > now ||
      !Number.isFinite(game.gameDuration) ||
      game.gameDuration < 300 ||
      !Number.isSafeInteger(game.gameId) ||
      game.gameId <= 0 ||
      entry.gameId !== game.gameId ||
      ['Abort', 'Aborted', 'Remake'].includes(game.endOfGameResult)
    )
      continue

    let championId: number | undefined
    let win: boolean | undefined
    let role: DraftRole | null = null
    if (entry.source === 'sgp') {
      const players = entry.data.json.participants?.filter((p) => p.puuid === puuid) ?? []
      if (players.length !== 1 || players[0].gameEndedInEarlySurrender) continue
      championId = players[0].championId
      win = players[0].win
      role = draftRole(players[0].teamPosition)
    } else {
      const identities =
        entry.data.participantIdentities?.filter((p) => p.player?.puuid === puuid) ?? []
      if (identities.length !== 1) continue
      const players =
        entry.data.participants?.filter((p) => p.participantId === identities[0].participantId) ??
        []
      if (players.length !== 1 || players[0].stats?.gameEndedInEarlySurrender) continue
      championId = players[0].championId
      win = players[0].stats?.win
      // LCU summaries do not reliably identify modern team positions.
    }
    if (!Number.isInteger(championId) || !championId || championId < 1 || typeof win !== 'boolean')
      continue
    records.push({ gameId: game.gameId, created: game.gameCreation, championId, win, role })
  }
  const seen = new Set<number>()
  const recent = records
    .sort((a, b) => b.created - a.created)
    .filter((row) => {
      if (seen.has(row.gameId)) return false
      seen.add(row.gameId)
      return true
    })
    .slice(0, 50)
  const pool = (rows: typeof recent): PoolChampion[] => {
    const champions = new Map<number, PoolChampion>()
    for (const row of rows) {
      const item = champions.get(row.championId) ?? {
        championId: row.championId,
        games: 0,
        wins: 0
      }
      item.games += 1
      item.wins += Number(row.win)
      champions.set(row.championId, item)
    }
    return [...champions.values()].sort((a, b) => b.games - a.games || a.championId - b.championId)
  }
  return {
    games: recent.length,
    champions: pool(recent),
    roles: Object.fromEntries(
      DRAFT_ROLES.map((role) => [role, recent.filter((row) => row.role === role).length])
    ),
    byRole: Object.fromEntries(
      DRAFT_ROLES.map((role) => [role, pool(recent.filter((row) => row.role === role))])
    ),
    unknownRoleGames: recent.filter((row) => !row.role).length
  }
}

export function inferRole(history?: PlayerHistory): DraftRole | null {
  const roles = DRAFT_ROLES.map((role) => ({ role, count: history?.roles[role] ?? 0 })).sort(
    (a, b) => b.count - a.count
  )
  return roles[0].count >= 3 &&
    roles[0].count > roles[1].count &&
    roles[0].count >= (history?.games ?? 0) * 0.5
    ? roles[0].role
    : null
}

function rolePool(history: PlayerHistory | undefined, role: DraftRole) {
  if (!history) return []
  // All-position fallback is explicit in the UI; never combine it with known other-lane games.
  return history.unknownRoleGames === history.games
    ? history.champions
    : (history.byRole[role] ?? [])
}

export function buildTargetPool(
  context: DraftContext,
  histories: Record<string, PlayerHistory>,
  role: DraftRole | null,
  manualPuuid: string | null
): TargetPool {
  const result: TargetPool = {
    source: 'unresolved',
    players: [],
    champions: [],
    unknownRole: false
  }
  if (!role) return result
  const manual = context.enemies.find((p) => p.puuid === manualPuuid)
  const assigned = context.enemies.filter((p) => p.position === role)
  if (manual || assigned.length === 1) {
    result.source = manual ? 'manual' : 'client'
    result.players = [{ player: manual ?? assigned[0], weight: 1 }]
  } else {
    result.source = 'history'
    const weights = context.enemies.map((player) => {
      const history = histories[player.puuid]
      const roleGames = history?.roles[role] ?? 0
      return {
        player,
        weight:
          player.position && player.position !== role
            ? 0
            : (roleGames + 1) / ((history?.games ?? 0) + 5)
      }
    })
    if (
      !weights.some(
        ({ player, weight }) => weight > 0 && (histories[player.puuid]?.roles[role] ?? 0) >= 3
      )
    )
      return { ...result, source: 'unresolved' }
    // Unseen identities retain uncertainty instead of making one known player look certain.
    const total =
      weights.reduce((sum, row) => sum + row.weight, 0) + (5 - context.enemies.length) * 0.2
    result.players = weights
      .filter((row) => row.weight > 0)
      .map((row) => ({ ...row, weight: row.weight / total }))
  }
  const weighted = new Map<number, number>()
  for (const { player, weight } of result.players) {
    if (player.lockedChampionId > 0) {
      weighted.set(player.lockedChampionId, (weighted.get(player.lockedChampionId) ?? 0) + weight)
      continue
    }
    const history = histories[player.puuid]
    if (history?.games && history.unknownRoleGames === history.games) result.unknownRole = true
    const pool = rolePool(history, role).filter(
      (row) => !context.banned.has(row.championId) && !context.locked.has(row.championId)
    )
    const total = pool.reduce((sum, row) => sum + row.games, 0)
    for (const row of pool)
      weighted.set(
        row.championId,
        (weighted.get(row.championId) ?? 0) + (weight * row.games) / total
      )
  }
  // Preserve omitted mass in coverage rather than renormalizing the displayed subset.
  result.champions = [...weighted]
    .map(([championId, weight]) => ({ championId, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12)
  return result
}

export function pickCandidates(
  context: DraftContext,
  history: PlayerHistory | undefined,
  role: DraftRole | null,
  manual: number[] | null,
  pickable: Set<number>,
  disabled: Set<number>
): PoolChampion[] {
  if (!role) return []
  const pool = rolePool(history, role)
  const ids =
    context.self.lockedChampionId > 0
      ? [context.self.lockedChampionId]
      : (manual ?? pool.filter((p) => p.games >= 2).map((p) => p.championId))
  return [...new Set(ids)]
    .filter(
      (id) =>
        id === context.self.lockedChampionId ||
        (pickable.has(id) &&
          !disabled.has(id) &&
          !context.banned.has(id) &&
          !context.locked.has(id) &&
          !context.allyIntents.has(id))
    )
    .slice(0, MAX_CANDIDATES)
    .map(
      (championId) =>
        pool.find((p) => p.championId === championId) ?? { championId, games: 0, wins: 0 }
    )
}

export function rankBans(
  context: DraftContext,
  histories: Record<string, PlayerHistory>,
  bannable: Set<number>,
  disabled: Set<number>,
  comfortable: number[]
): BanAdvice[] {
  if (context.banFinished) return []
  const rows = new Map<number, Array<Omit<BanAdvice, 'otherPlayers'>>>()
  for (const player of context.enemies) {
    if (player.lockedChampionId) continue
    const history = histories[player.puuid]
    if (!history) continue
    for (const champion of history.champions) {
      const id = champion.championId
      if (
        champion.games < 2 ||
        !bannable.has(id) ||
        disabled.has(id) ||
        context.banned.has(id) ||
        context.locked.has(id) ||
        context.allyIntents.has(id) ||
        comfortable.includes(id)
      )
        continue
      const score =
        (champion.games / history.games) *
        (history.games / (history.games + 10)) *
        ((champion.wins + 5) / (champion.games + 10))
      const row = { ...champion, player, poolGames: history.games, score }
      const group = rows.get(id) ?? []
      group.push(row)
      rows.set(id, group)
    }
  }
  return [...rows.values()]
    .map((group): BanAdvice => {
      group.sort((a, b) => b.score - a.score || b.games - a.games)
      return {
        ...group[0],
        score: group.reduce((sum, row) => sum + row.score, 0),
        otherPlayers: group.slice(1).map((row) => row.player)
      }
    })
    .sort((a, b) => b.score - a.score || b.games - a.games || a.championId - b.championId)
    .slice(0, 3)
}

/** Heuristic ordering, not a predicted game win rate. Missing/small pairs remain unknown. */
export function rankPicks(
  candidates: PoolChampion[],
  target: TargetPool,
  samples: Record<number, MatchupSample[]>
): PickAdvice[] {
  return candidates
    .map((candidate): PickAdvice => {
      const pairs = samples[candidate.championId] ?? []
      let coverage = 0
      let weightedEdge = 0
      let favorableCoverage = 0
      let worstEdge = 0
      let worst: PickAdvice['worst'] = null
      const rows = target.champions.map((enemy) => {
        const pair = pairs.find((p) => p.championId === enemy.championId)
        if (!pair || pair.games < 50) return { ...enemy, games: pair?.games ?? null, winRate: null }
        const rate = pair.wins / pair.games
        // Shrink noisy pairs toward neutral; penalize a bad matchup as well as the mean.
        const edge = ((rate - 0.5) * pair.games) / (pair.games + 200)
        coverage += enemy.weight
        weightedEdge += enemy.weight * edge
        if (edge > 0.01) favorableCoverage += enemy.weight
        worstEdge = Math.min(worstEdge, edge)
        if (edge < -0.01 && (!worst || rate < worst.winRate))
          worst = { championId: enemy.championId, winRate: rate }
        return { ...enemy, games: pair.games, winRate: rate }
      })
      return {
        ...candidate,
        rows,
        coverage,
        // Describe the known matchups independently of familiarity and ranking penalties.
        outlook:
          coverage < 0.6
            ? 'unknown'
            : weightedEdge / coverage > 0.01
              ? 'favorable'
              : weightedEdge / coverage < -0.01
                ? 'unfavorable'
                : 'even',
        favorableCoverage,
        worst,
        score:
          coverage >= 0.6
            ? weightedEdge +
              worstEdge * 0.25 -
              (1 - coverage) * 0.08 +
              Math.min(candidate.games, 20) * 0.0005
            : null
      }
    })
    .sort(
      (a, b) =>
        Number(b.score !== null) - Number(a.score !== null) ||
        (b.score ?? 0) - (a.score ?? 0) ||
        b.games - a.games ||
        a.championId - b.championId
    )
}
