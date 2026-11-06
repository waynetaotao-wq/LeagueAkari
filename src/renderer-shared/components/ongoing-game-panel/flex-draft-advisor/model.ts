import type { OngoingGameProviderValue } from '@renderer-shared/providers/ongoing-game/types'
import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import type {
  Action,
  ChampSelectSession,
  ChampSelectTeam
} from '@shared/types/league-client/champ-select'

import { planBanSequence } from './ban-planner'

export const DRAFT_ROLES = ['top', 'jungle', 'middle', 'bottom', 'utility'] as const
export type DraftRole = (typeof DRAFT_ROLES)[number]
export const MAX_CANDIDATES = 10
const DAY = 86_400_000
const MISSING_MATCHUP_RISK_EDGE = -0.08
// LCU identifies 积分对战 五排 as RANKED_PREMADE_5x5 (710), separate from Ranked Flex (440).
const PREMADE_FIVE_QUEUE_ID = 710
const CLASH_QUEUE_ID = 700
export type DraftQueueId = typeof PREMADE_FIVE_QUEUE_ID | typeof CLASH_QUEUE_ID

export interface PoolChampion {
  championId: number
  games: number
  wins: number
  /** Thirty-day half-life evidence; raw games/wins remain the displayed counts. */
  recencyGames?: number
  recencyWins?: number
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
  banState: 'active' | 'waiting' | 'finished'
  banBudget: number
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
  source: 'manual' | 'client' | 'assignment' | 'history' | 'unresolved'
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
  matchupScore: number | null
  familiarityScore: number
  composition: CompositionAdvice
}

export type CompositionSignal =
  | 'adds-frontline'
  | 'frontline-needed'
  | 'adds-backline'
  | 'backline-needed'
  | 'adds-utility'
  | 'utility-needed'
  | 'enemy-frontline'
  | 'enemy-backline'
  | 'limited-data'

export interface CompositionAdvice {
  score: number
  signals: CompositionSignal[]
  knownAllies: number
}

export interface DraftRankingOptions {
  context?: DraftContext
  selfRole?: DraftRole | null
  /** Client champion classes, not lane assignments or measured synergy statistics. */
  championRoles?: Record<number, string[]>
}

export interface BanAdvice extends PoolChampion {
  player: DraftPlayer
  otherPlayers: DraftPlayer[]
  poolGames: number
  score: number
  replacementGap: number
  allyCost: number
  compositionScore: number
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

function draftBanPlan(
  session: ChampSelectSession
): Pick<DraftContext, 'banState' | 'banBudget' | 'banFinished'> {
  const waiting = { banState: 'waiting' as const, banBudget: 0, banFinished: false }
  const finished = { banState: 'finished' as const, banBudget: 0, banFinished: true }
  if (['FINALIZATION', 'GAME_STARTING'].includes(session.timer.phase)) return finished

  const unique = new Map<number, Action>()
  for (const action of session.actions.flat()) {
    const previous = unique.get(action.id)
    if (previous) {
      if (
        previous.type !== action.type ||
        previous.actorCellId !== action.actorCellId ||
        previous.isAllyAction !== action.isAllyAction ||
        previous.completed !== action.completed
      )
        return waiting
      previous.isInProgress ||= action.isInProgress
    } else unique.set(action.id, { ...action })
  }
  const actions = [...unique.values()]
  const alliedCells = new Set(session.myTeam.map((player) => player.cellId))
  const enemyCells = new Set(session.theirTeam.map((player) => player.cellId))
  const ownAction = (action: Action) => {
    const allied = alliedCells.has(action.actorCellId)
    if (allied === enemyCells.has(action.actorCellId) || allied !== action.isAllyAction) return null
    return allied
  }
  const bans = actions.filter((action) => action.type === 'ban')
  const completedOwn = bans.filter(
    (action) => action.completed && ownAction(action) === true
  ).length
  // Both supported queues give each side five slots. A completed empty ban consumes its slot.
  if (completedOwn >= 5) return finished
  if (bans.some((action) => ownAction(action) === null)) return waiting

  let current = actions.findIndex((action) => !action.completed && action.isInProgress)
  if (current < 0) current = actions.findIndex((action) => !action.completed)
  if (current < 0 || actions[current].type !== 'ban') return waiting
  let start = current
  let end = current + 1
  while (start > 0 && actions[start - 1].type === 'ban') start--
  while (end < actions.length && actions[end].type === 'ban') end++
  const banBudget = Math.min(
    5 - completedOwn,
    actions.slice(start, end).filter((action) => !action.completed && ownAction(action) === true)
      .length
  )
  // Do not plan across intervening picks, or assume missing Clash rounds have already ended.
  return banBudget > 0 ? { banState: 'active', banBudget, banFinished: false } : waiting
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

  const visible = [...session.myTeam, ...session.theirTeam].filter(visibleMember)
  const uniqueMember = (member: ChampSelectTeam) =>
    visibleMember(member) && visible.filter((other) => other.puuid === member.puuid).length === 1
  const self = session.myTeam.find(
    (member) => member.puuid === game.selfPuuid && member.cellId === session.localPlayerCellId
  )
  if (!self || !uniqueMember(self)) return null
  const actions = session.actions.flat()
  const lockedCells = new Set(
    actions
      .filter((action) => action.type === 'pick' && action.completed)
      .map((action) => action.actorCellId)
  )
  const player = (member: ChampSelectTeam): DraftPlayer => ({
    puuid: member.puuid,
    name: member.tagLine?.trim()
      ? `${member.gameName.trim()}#${member.tagLine.trim()}`
      : member.gameName.trim(),
    cellId: member.cellId,
    position: draftRole(member.assignedPosition),
    // The member's current champion reflects trades; the original completed action does not.
    lockedChampionId: lockedCells.has(member.cellId) ? member.championId : 0,
    hoverChampionId: member.championPickIntent || member.championId || 0
  })
  const allies = session.myTeam.filter(uniqueMember).map(player)
  const enemies = session.theirTeam.filter(uniqueMember).map(player)
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
        .filter((m) => m.puuid !== self.puuid && !lockedCells.has(m.cellId))
        .map((m) => m.championPickIntent || m.championId)
        .filter((id) => id > 0)
    ),
    ...draftBanPlan(session)
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
  const unique = new Map<number, { record: (typeof records)[number]; roles: Set<DraftRole> }>()
  const conflicting = new Set<number>()
  for (const record of records) {
    const previous = unique.get(record.gameId)
    if (!previous) {
      unique.set(record.gameId, {
        record,
        roles: new Set(record.role ? [record.role] : [])
      })
      continue
    }
    if (
      previous.record.created !== record.created ||
      previous.record.championId !== record.championId ||
      previous.record.win !== record.win
    )
      conflicting.add(record.gameId)
    if (record.role) previous.roles.add(record.role)
  }
  // Resolve repeated evidence before the unique-game limit; input order cannot choose a result.
  const recent = [...unique.values()]
    .filter(({ record }) => !conflicting.has(record.gameId))
    .map(({ record, roles }) => ({
      ...record,
      role: roles.size === 1 ? [...roles][0] : null
    }))
    .sort((a, b) => b.created - a.created || a.gameId - b.gameId)
    .slice(0, 50)
  const pool = (rows: typeof recent): PoolChampion[] => {
    const champions = new Map<number, PoolChampion>()
    for (const row of rows) {
      const item = champions.get(row.championId) ?? {
        championId: row.championId,
        games: 0,
        wins: 0,
        recencyGames: 0,
        recencyWins: 0
      }
      item.games += 1
      item.wins += Number(row.win)
      const weight = 2 ** (-(now - row.created) / (30 * DAY))
      item.recencyGames! += weight
      item.recencyWins! += weight * Number(row.win)
      champions.set(row.championId, item)
    }
    return [...champions.values()].sort(
      (a, b) =>
        effectiveGames(b) - effectiveGames(a) || b.games - a.games || a.championId - b.championId
    )
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

function clientRoleAssignments(players: DraftPlayer[]): Map<string, DraftRole> | null {
  const assigned = new Map<string, DraftRole>()
  const occupied = new Set<DraftRole>()
  for (const player of players) {
    if (!player.position) continue
    // Conflicting client positions cannot prove a unique remaining position.
    if (occupied.has(player.position)) return null
    occupied.add(player.position)
    assigned.set(player.puuid, player.position)
  }
  // Missing visible players leave unknown slots; never infer who occupies a hidden slot.
  if (players.length === DRAFT_ROLES.length && occupied.size === DRAFT_ROLES.length - 1) {
    const player = players.find((player) => !player.position)!
    assigned.set(
      player.puuid,
      DRAFT_ROLES.find((role) => !occupied.has(role))!
    )
  }
  return assigned
}

function inferredOpponents(
  context: DraftContext,
  histories: Record<string, PlayerHistory>,
  role: DraftRole
): Pick<TargetPool, 'source' | 'players'> | null {
  const assignments = clientRoleAssignments(context.enemies)
  // Conflicting client assignments are not evidence for a unique lane opponent.
  if (!assignments) return null
  const assignedRoles = [...assignments.values()]
  const assigned = context.enemies.find((player) => assignments.get(player.puuid) === role)
  if (assigned)
    return {
      source: assigned.position ? 'client' : 'assignment',
      players: [{ player: assigned, weight: 1 }]
    }

  const roles = DRAFT_ROLES.filter((position) => !assignedRoles.includes(position))
  const players: Array<DraftPlayer | null> = context.enemies
    .filter((player) => !assignments.has(player.puuid))
    .sort((a, b) => a.puuid.localeCompare(b.puuid))
  // Keep invisible slots in every assignment; do not recover their identities or history.
  while (players.length < roles.length) players.push(null)
  if (
    !players.some(
      (player) =>
        player && roles.some((position) => (histories[player.puuid]?.roles[position] ?? 0) >= 3)
    )
  )
    return null

  let total = 0
  const weights = new Map<DraftPlayer, number>()
  const visit = (
    index: number,
    remaining: DraftRole[],
    weight: number,
    opponent: DraftPlayer | null
  ) => {
    if (index === players.length) {
      total += weight
      if (opponent) weights.set(opponent, (weights.get(opponent) ?? 0) + weight)
      return
    }
    const player = players[index]
    const history = player ? histories[player.puuid] : undefined
    for (const position of remaining) {
      const affinity = ((history?.roles[position] ?? 0) + 1) / ((history?.games ?? 0) + 5)
      visit(
        index + 1,
        remaining.filter((other) => other !== position),
        weight * affinity,
        position === role ? player : opponent
      )
    }
  }
  // At most 5! assignments. Lane affinities remain heuristics, not calibrated probabilities.
  visit(0, roles, 1, null)
  return {
    source: 'history',
    players: [...weights].map(([player, weight]) => ({ player, weight: weight / total }))
  }
}

export function buildTargetPool(
  context: DraftContext,
  histories: Record<string, PlayerHistory>,
  role: DraftRole | null,
  manualPuuid: string | null,
  disabled: Set<number> = new Set()
): TargetPool {
  const result: TargetPool = {
    source: 'unresolved',
    players: [],
    champions: [],
    unknownRole: false
  }
  if (!role) return result
  const manual = context.enemies.find((p) => p.puuid === manualPuuid)
  if (manual) {
    result.source = 'manual'
    result.players = [{ player: manual, weight: 1 }]
  } else {
    const inferred = inferredOpponents(context, histories, role)
    if (!inferred) return result
    result.source = inferred.source
    result.players = inferred.players
  }
  const available = (row: PoolChampion) =>
    !context.banned.has(row.championId) &&
    !context.locked.has(row.championId) &&
    !disabled.has(row.championId)
  const weighted = new Map<number, number>()
  for (const { player, weight } of result.players) {
    if (player.lockedChampionId > 0) {
      weighted.set(player.lockedChampionId, (weighted.get(player.lockedChampionId) ?? 0) + weight)
      continue
    }
    const history = histories[player.puuid]
    if (history?.games && history.unknownRoleGames === history.games) result.unknownRole = true
    const pool = rolePool(history, role).filter(available)
    let total = pool.reduce((sum, row) => sum + effectiveGames(row), 0)
    if (history && history.unknownRoleGames > 0 && history.unknownRoleGames < history.games) {
      const knownPositionGames = new Map<number, number>()
      for (const position of DRAFT_ROLES)
        for (const row of history.byRole[position] ?? [])
          knownPositionGames.set(
            row.championId,
            (knownPositionGames.get(row.championId) ?? 0) + effectiveGames(row)
          )
      // Unknown-position games remain uncovered evidence, not invented lane champions.
      // Use the same recency weights and availability rules as the known-position pool.
      for (const row of history.champions.filter(available))
        total += Math.max(0, effectiveGames(row) - (knownPositionGames.get(row.championId) ?? 0))
    }
    for (const row of pool) {
      // A singleton remains unknown mass; removing other mains must not turn it into certainty.
      if (row.games < 2) continue
      weighted.set(
        row.championId,
        (weighted.get(row.championId) ?? 0) + (weight * effectiveGames(row)) / total
      )
    }
  }
  // Analyze every known target; missing evidence retains its mass independently of UI limits.
  result.champions = [...weighted]
    .map(([championId, weight]) => ({ championId, weight }))
    .sort((a, b) => b.weight - a.weight || a.championId - b.championId)
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

function effectiveGames(champion: PoolChampion) {
  return champion.recencyGames ?? champion.games
}

function effectiveWins(champion: PoolChampion) {
  return champion.recencyWins ?? champion.wins
}

function familiarity(champion: PoolChampion) {
  const games = effectiveGames(champion)
  // Recent practice matters more than lifetime volume; performance is strongly shrunk.
  return (0.018 * games) / (games + 6) + 0.02 * ((effectiveWins(champion) + 5) / (games + 10) - 0.5)
}

function championStructure(roles: string[] | undefined) {
  if (!roles) return null
  const tags = new Set(roles.map((role) => role.toLowerCase()))
  if (!['tank', 'fighter', 'mage', 'marksman', 'support', 'assassin'].some((tag) => tags.has(tag)))
    return null
  return {
    frontline: tags.has('tank') ? 1 : tags.has('fighter') ? 0.6 : 0,
    // Hybrid mage tags do not establish range (e.g. both Ahri and Sylas are mage/assassin).
    backline: tags.has('marksman')
      ? 1
      : tags.has('mage')
        ? ['tank', 'fighter', 'assassin'].some((tag) => tags.has(tag))
          ? null
          : 1
        : 0,
    utility: tags.has('support') ? 1 : 0
  }
}

/** Broad class coverage only: no invented damage types, CC, or champion-combo win rates. */
function compositionAdvice(
  candidateId: number,
  players: DraftPlayer[],
  selfPuuid: string,
  championRoles: Record<number, string[]> = {},
  enemies: DraftPlayer[] = [],
  unavailable: ReadonlySet<number> = new Set()
): CompositionAdvice {
  const result: CompositionAdvice = { score: 0, signals: [], knownAllies: 0 }
  const candidate = championStructure(championRoles[candidateId])
  const totals = { frontline: 0, backline: 0, utility: 0 }
  let ambiguousBackline = false
  let unknownSelectedAlly = false
  let knownWeight = 0
  const reserved = new Set([
    candidateId,
    ...unavailable,
    ...[...players, ...enemies].map((player) => player.lockedChampionId).filter((id) => id > 0)
  ])
  const counted = new Set<number>()
  for (const player of players) {
    if (player.puuid === selfPuuid) continue
    const championId = player.lockedChampionId || player.hoverChampionId
    if ((!player.lockedChampionId && reserved.has(championId)) || counted.has(championId)) continue
    counted.add(championId)
    const structure = championStructure(championRoles[championId])
    if (!structure) {
      unknownSelectedAlly ||= championId > 0
      continue
    }
    const weight = player.lockedChampionId ? 1 : 0.5
    result.knownAllies++
    knownWeight += weight
    ambiguousBackline ||= structure.backline === null
    for (const key of ['frontline', 'backline', 'utility'] as const)
      totals[key] += weight * (structure[key] ?? 0)
  }
  if (!candidate) {
    result.signals.push('limited-data')
    return result
  }
  const enoughAllies = result.knownAllies >= 2 && knownWeight >= 1 && !unknownSelectedAlly
  if (!enoughAllies) result.signals.push('limited-data')
  const factors = [
    {
      key: 'frontline',
      target: 0.8,
      bonus: 0.018,
      added: 'adds-frontline',
      missing: 'frontline-needed'
    },
    {
      key: 'backline',
      target: 1,
      bonus: 0.012,
      added: 'adds-backline',
      missing: 'backline-needed'
    },
    { key: 'utility', target: 0.5, bonus: 0.006, added: 'adds-utility', missing: 'utility-needed' }
  ] as const
  // Hovered picks contribute half as much and do not make a partial draft look complete.
  const certainty = Math.min(1, knownWeight / 3)
  for (const factor of enoughAllies ? factors : []) {
    if (factor.key === 'utility' && result.knownAllies < 3) continue
    if (factor.key === 'backline' && (ambiguousBackline || candidate.backline === null)) continue
    const deficit = Math.max(0, factor.target - totals[factor.key])
    if (!deficit) continue
    const contribution = candidate[factor.key] ?? 0
    if (contribution > 0) {
      result.score += deficit * contribution * factor.bonus * certainty
      result.signals.push(factor.added)
    } else {
      result.signals.push(factor.missing)
    }
  }
  const enemyStructures = enemies
    .filter((player) => player.lockedChampionId > 0)
    .map((player) => championStructure(championRoles[player.lockedChampionId]))
    .filter((row) => row !== null)
  const candidateTags = new Set(
    (championRoles[candidateId] ?? []).map((role) => role.toLowerCase())
  )
  if (enemyStructures.length >= 2) {
    if (
      enemyStructures.reduce((sum, row) => sum + row.frontline, 0) >= 1.5 &&
      candidateTags.has('marksman')
    ) {
      result.score += 0.004
      result.signals.push('enemy-frontline')
    }
    if (
      enemyStructures.reduce((sum, row) => sum + (row.backline ?? 0), 0) >= 2 &&
      (candidateTags.has('assassin') || candidateTags.has('fighter'))
    ) {
      result.score += 0.003
      result.signals.push('enemy-backline')
    }
  }
  result.score = Math.min(0.02, result.score)
  const signalPriority = (signal: CompositionSignal) =>
    signal.startsWith('adds-') || signal.startsWith('enemy-')
      ? 0
      : signal === 'limited-data'
        ? 2
        : 1
  result.signals.sort((a, b) => signalPriority(a) - signalPriority(b))
  return result
}

export function rankBans(
  context: DraftContext,
  histories: Record<string, PlayerHistory>,
  bannable: Set<number>,
  disabled: Set<number>,
  comfortable: number[],
  options: DraftRankingOptions = {}
): BanAdvice[] {
  if (context.banState !== 'active' || context.banFinished) return []
  return planBanSequence(context.banBudget, (removed) => {
    const banned = new Set([...context.banned, ...removed])
    return rankAvailableBans(
      { ...context, banned },
      histories,
      bannable,
      disabled,
      comfortable,
      options
    )
  })
}

function championStrength(champion: PoolChampion) {
  const games = effectiveGames(champion)
  return (Math.sqrt(games / (games + 4)) * (effectiveWins(champion) + 5)) / (games + 10)
}

function teamFamiliarity(pools: PoolChampion[][], excludedChampion?: number) {
  const choices = new Map<number, Array<{ player: number; strength: number }>>()
  pools.forEach((pool, player) => {
    // Only P-1 other players can occupy heroes: one of this player's top P is always free.
    // Filter the excluded hero first, and prune only this matching problem, never ban candidates.
    const candidates = pool
      .filter((champion) => champion.championId !== excludedChampion)
      .map((champion) => ({ champion, strength: championStrength(champion) }))
      .sort((a, b) => b.strength - a.strength || a.champion.championId - b.champion.championId)
      .slice(0, pools.length)
    for (const { champion, strength } of candidates) {
      const users = choices.get(champion.championId) ?? []
      users.push({ player, strength })
      choices.set(champion.championId, users)
    }
  })
  // Each player has a private unknown replacement. Known champions may be assigned only once.
  let values = Array<number>(1 << pools.length).fill(-Infinity)
  values[0] = pools.length * 0.2
  for (const [, users] of [...choices].sort(([a], [b]) => a - b)) {
    const next = [...values]
    for (let mask = 0; mask < values.length; mask++) {
      if (!Number.isFinite(values[mask])) continue
      for (const { player, strength } of users) {
        const bit = 1 << player
        if (mask & bit) continue
        next[mask | bit] = Math.max(next[mask | bit], values[mask] + strength - 0.2)
      }
    }
    values = next
  }
  return Math.max(...values)
}

function teamReplacementGap(pools: PoolChampion[][]) {
  const before = teamFamiliarity(pools)
  const gaps = new Map<number, number>()
  return (championId: number) => {
    if (!gaps.has(championId)) {
      const gap = Math.max(0, before - teamFamiliarity(pools, championId))
      // Equivalent assignments can differ only in floating-point addition order.
      gaps.set(championId, gap <= Number.EPSILON * Math.max(1, before) * 2 ? 0 : gap)
    }
    return gaps.get(championId)!
  }
}

function rankAvailableBans(
  context: DraftContext,
  histories: Record<string, PlayerHistory>,
  bannable: Set<number>,
  disabled: Set<number>,
  comfortable: number[],
  options: DraftRankingOptions
): BanAdvice[] {
  const available = (champion: PoolChampion) =>
    !context.banned.has(champion.championId) &&
    !context.locked.has(champion.championId) &&
    !disabled.has(champion.championId)
  const enemyPositions = clientRoleAssignments(context.enemies)
  const allyPositions = clientRoleAssignments(context.allies)
  const pools = context.enemies
    .filter((player) => !player.lockedChampionId)
    .sort((a, b) => a.puuid.localeCompare(b.puuid))
    .map((player) => {
      const history = histories[player.puuid]
      const role = enemyPositions?.get(player.puuid) ?? player.position
      const pool = (role ? rolePool(history, role) : (history?.champions ?? [])).filter(available)
      return { player, history, pool }
    })
  const replacementGapFor = teamReplacementGap(pools.map(({ pool }) => pool))
  const alliedPools = context.allies
    .filter((player) => !player.lockedChampionId)
    .sort((a, b) => a.puuid.localeCompare(b.puuid))
    .map((player) => {
      const history = histories[player.puuid]
      const clientRole = allyPositions?.get(player.puuid) ?? player.position
      const role =
        player.puuid === context.self.puuid ? (options.selfRole ?? clientRole) : clientRole
      // Keep the existing two-game allied evidence gate; smaller samples use the unknown floor.
      return (role ? rolePool(history, role) : (history?.champions ?? [])).filter(
        (champion) => champion.games >= 2 && available(champion)
      )
    })
  const allyCostFor = teamReplacementGap(alliedPools)
  const withoutBannedHover = (players: DraftPlayer[]) =>
    players.map((player) =>
      context.banned.has(player.hoverChampionId) ? { ...player, hoverChampionId: 0 } : player
    )
  const enemies = withoutBannedHover(context.enemies)
  const allies = withoutBannedHover(context.allies)
  const unavailable = new Set([...context.banned, ...context.locked])
  const rows = new Map<number, Array<Omit<BanAdvice, 'otherPlayers'>>>()
  for (const { player, history, pool } of pools) {
    if (!history) continue
    const total = pool.reduce((sum, champion) => sum + effectiveGames(champion), 0)
    if (!total) continue
    for (const champion of pool) {
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
      const replacementGap = replacementGapFor(id)
      const compositionScore = compositionAdvice(
        id,
        enemies,
        player.puuid,
        options.championRoles,
        allies,
        unavailable
      ).score
      const games = effectiveGames(champion)
      const value =
        (games / total) *
        (total / (total + 10)) *
        ((effectiveWins(champion) + 5) / (games + 10)) *
        (1 + replacementGap + compositionScore * 4)
      // Keep each contribution bounded before combining shared mains. This is utility,
      // not pick probability; the monotone transform preserves each player's ordering.
      const score = value / (1 + value)
      const row = {
        ...champion,
        player,
        poolGames: history.games,
        score,
        replacementGap,
        allyCost: 0,
        compositionScore
      }
      const group = rows.get(id) ?? []
      group.push(row)
      rows.set(id, group)
    }
  }
  return [...rows.values()]
    .map((group) => {
      group.sort(
        (a, b) =>
          b.score - a.score || b.games - a.games || a.player.puuid.localeCompare(b.player.puuid)
      )
      const championId = group[0].championId
      const allyCost = allyCostFor(championId)
      const advice: BanAdvice = {
        ...group[0],
        // One unique champion can only be picked once: shared mains add bounded coverage.
        score: 1 - group.reduce((remaining, row) => remaining * (1 - row.score), 1),
        allyCost,
        otherPlayers: group.slice(1).map((row) => row.player)
      }
      advice.score *= 1 - 0.6 * allyCost
      return advice
    })
    .sort((a, b) => b.score - a.score || b.games - a.games || a.championId - b.championId)
}

/** Heuristic ordering, not a predicted game win rate. Missing/small pairs remain unknown. */
export function rankPicks(
  candidates: PoolChampion[],
  target: TargetPool,
  samples: Record<number, MatchupSample[]>,
  options: DraftRankingOptions = {}
): PickAdvice[] {
  return candidates
    .map((candidate): PickAdvice => {
      const pairs = samples[candidate.championId] ?? []
      let coverage = 0
      let weightedEdge = 0
      let favorableCoverage = 0
      let uncertainty = 0
      const downside: Array<{ edge: number; weight: number }> = []
      let worst: PickAdvice['worst'] = null
      let worstImpact = 0
      let worstEdge = 0
      const rows = target.champions.map((enemy) => {
        const matches = pairs.filter((p) => p.championId === enemy.championId)
        const pair = matches.length === 1 ? matches[0] : undefined
        if (
          !pair ||
          !Number.isSafeInteger(pair.games) ||
          !Number.isSafeInteger(pair.wins) ||
          pair.games < 50 ||
          pair.wins < 0 ||
          pair.wins > pair.games ||
          !Number.isFinite(enemy.weight) ||
          enemy.weight <= 0
        )
          return { ...enemy, games: pair?.games ?? null, winRate: null }
        const rate = pair.wins / pair.games
        // Shrink noisy pairs toward neutral; penalize a bad matchup as well as the mean.
        const edge = ((rate - 0.5) * pair.games) / (pair.games + 200)
        coverage += enemy.weight
        weightedEdge += enemy.weight * edge
        if (edge > 0.01) favorableCoverage += enemy.weight
        const posteriorRate = 0.5 + edge
        uncertainty +=
          enemy.weight * Math.sqrt((posteriorRate * (1 - posteriorRate)) / (pair.games + 201))
        downside.push({ edge: Math.min(0, edge), weight: enemy.weight })
        const impact = enemy.weight * -edge
        if (
          edge < -0.01 &&
          (!worst ||
            impact > worstImpact ||
            (impact === worstImpact &&
              (edge < worstEdge || (edge === worstEdge && enemy.championId < worst.championId))))
        ) {
          worst = { championId: enemy.championId, winRate: rate }
          worstImpact = impact
          worstEdge = edge
        }
        return { ...enemy, games: pair.games, winRate: rate }
      })
      const missingMass = Math.max(0, 1 - coverage)
      // A conservative risk assumption, never a measured win rate or an evidence row.
      if (missingMass > 0) downside.push({ edge: MISSING_MATCHUP_RISK_EDGE, weight: missingMass })
      // Weighted lower tail: a rare bad pair matters, but does not dominate a common threat.
      let remaining = 0.2
      let tailEdge = 0
      for (const pair of downside.sort((a, b) => a.edge - b.edge)) {
        const weight = Math.min(remaining, pair.weight)
        tailEdge += (pair.edge * weight) / 0.2
        remaining -= weight
        if (remaining <= 0) break
      }
      const matchupScore =
        coverage >= 0.6
          ? weightedEdge +
            tailEdge * 0.3 +
            missingMass * MISSING_MATCHUP_RISK_EDGE -
            uncertainty * 0.35
          : null
      const familiarityScore = familiarity(candidate)
      const composition = compositionAdvice(
        candidate.championId,
        options.context?.allies ?? [],
        options.context?.self.puuid ?? '',
        options.championRoles,
        options.context?.enemies,
        new Set([...(options.context?.banned ?? []), ...(options.context?.locked ?? [])])
      )
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
        matchupScore,
        familiarityScore,
        composition,
        score: matchupScore === null ? null : matchupScore + familiarityScore + composition.score
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
