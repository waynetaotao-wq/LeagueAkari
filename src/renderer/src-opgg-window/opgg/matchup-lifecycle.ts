import type { LaneName } from '@shared/utils/lane-assignment'

const IN_GAME_PHASES = new Set(['GameStart', 'InProgress', 'Reconnect'])

export interface MatchupSessionIdentity {
  sessionId: string | null
  gameId: number | null
}

export interface MatchupLifecycleState {
  current: MatchupSessionIdentity | null
  lastKnown: MatchupSessionIdentity | null
  generation: number
}

export interface ScopedManualTarget {
  championId: number
  owner: MatchupSessionIdentity
}

export interface MatchupTargetResolution {
  championId: number
  probability: number | null
  source: 'manual' | 'automatic'
}

export interface MatchupRequestToken {
  owner: MatchupSessionIdentity
  generation: number
}

interface ChampSelectSessionLike {
  id?: unknown
  gameId?: unknown
}

interface GameflowSessionLike {
  gameData?: {
    gameId?: unknown
  } | null
}

interface AssignedOpponentLike {
  championId?: unknown
  championPickIntent?: unknown
  assignedPosition?: unknown
}

interface RealTeamOpponentLike {
  championId?: unknown
  selectedPosition?: unknown
  position?: unknown
}

export interface RealMatchupValidation {
  status: 'waiting' | 'confirmed' | 'corrected'
  opponentChampionId: number | null
}

export type MatchupCorrectionDisposition = 'superseded' | 'applied' | 'drop-stale-lock'

function positiveGameId(value: unknown): number | null {
  const gameId = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(gameId) && gameId > 0 ? gameId : null
}

function sessionId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function championId(value: unknown): number | null {
  const id = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function resolveMatchupSessionIdentity(input: {
  phase: unknown
  champSelectSession: ChampSelectSessionLike | null | undefined
  gameflowSession: GameflowSessionLike | null | undefined
}): MatchupSessionIdentity | null {
  const phase = String(input.phase ?? '')
  const champSelect = input.champSelectSession
  const fromChampSelect = champSelect
    ? {
        sessionId: sessionId(champSelect.id),
        gameId: positiveGameId(champSelect.gameId)
      }
    : null
  const gameflowGameId = positiveGameId(input.gameflowSession?.gameData?.gameId)

  if (phase === 'ChampSelect') {
    return fromChampSelect && (fromChampSelect.sessionId || fromChampSelect.gameId)
      ? fromChampSelect
      : null
  }

  if (IN_GAME_PHASES.has(phase)) {
    // GameStart 交界处 gameflow 与 champ-select 独立推送；后者仍在时优先本局选人 gameId，
    // 避免短暂读取上一局残留 gameData 而把同一局误判成两局。
    if (
      phase === 'GameStart' &&
      fromChampSelect &&
      (fromChampSelect.sessionId || fromChampSelect.gameId)
    ) {
      return fromChampSelect
    }
    if (gameflowGameId) return { sessionId: null, gameId: gameflowGameId }
    return fromChampSelect && (fromChampSelect.sessionId || fromChampSelect.gameId)
      ? fromChampSelect
      : null
  }

  return null
}

export function areSameMatchupSession(
  left: MatchupSessionIdentity | null | undefined,
  right: MatchupSessionIdentity | null | undefined
): boolean {
  if (!left || !right) return false
  if (left.sessionId && right.sessionId && left.sessionId !== right.sessionId) return false
  if (left.gameId && right.gameId && left.gameId !== right.gameId) return false
  return Boolean(
    (left.sessionId && right.sessionId && left.sessionId === right.sessionId) ||
    (left.gameId && right.gameId && left.gameId === right.gameId)
  )
}

/** Vue 综合 watcher 使用稳定原始值，避免同局 session payload 每秒换对象就重启请求。 */
export function matchupSessionIdentityKey(
  identity: MatchupSessionIdentity | null | undefined
): string {
  return identity ? `${identity.sessionId ?? '-'}|${identity.gameId ?? '-'}` : ''
}

/** 仅接受属于当前对局的正整数 gameData id；乱序旧数据一律等待。 */
export function isCurrentMatchupGameData(
  identity: MatchupSessionIdentity | null | undefined,
  gameDataGameId: unknown
): boolean {
  const gameId = positiveGameId(gameDataGameId)
  return Boolean(identity?.gameId && gameId === identity.gameId)
}

function mergeSessionIdentity(
  previous: MatchupSessionIdentity,
  next: MatchupSessionIdentity
): MatchupSessionIdentity {
  return {
    sessionId: next.sessionId ?? previous.sessionId,
    gameId: next.gameId ?? previous.gameId
  }
}

export function observeMatchupSession(
  state: MatchupLifecycleState,
  next: MatchupSessionIdentity | null
): { state: MatchupLifecycleState; startedNewSession: boolean } {
  if (!next) {
    return {
      state: { ...state, current: null },
      startedNewSession: false
    }
  }

  if (state.lastKnown && areSameMatchupSession(state.lastKnown, next)) {
    const merged = mergeSessionIdentity(state.lastKnown, next)
    return {
      state: { ...state, current: merged, lastKnown: merged },
      startedNewSession: false
    }
  }

  return {
    state: {
      current: { ...next },
      lastKnown: { ...next },
      generation: state.generation + 1
    },
    startedNewSession: true
  }
}

export function resolveScopedMatchupTarget(input: {
  currentSession: MatchupSessionIdentity | null
  manualTarget: ScopedManualTarget | null
  enemyChampionIds: readonly number[]
  automaticResolution: { championId: number | null; probability: number } | null
}): MatchupTargetResolution | null {
  const enemies = new Set(input.enemyChampionIds)
  if (
    input.manualTarget &&
    areSameMatchupSession(input.manualTarget.owner, input.currentSession) &&
    enemies.has(input.manualTarget.championId)
  ) {
    return {
      championId: input.manualTarget.championId,
      probability: null,
      source: 'manual'
    }
  }

  const automatic = input.automaticResolution
  if (automatic?.championId && enemies.has(automatic.championId)) {
    return {
      championId: automatic.championId,
      probability: automatic.probability,
      source: 'automatic'
    }
  }

  return null
}

export function createMatchupRequestToken(
  state: MatchupLifecycleState
): MatchupRequestToken | null {
  return state.current
    ? {
        owner: { ...state.current },
        generation: state.generation
      }
    : null
}

export function isCurrentMatchupRequest(
  token: MatchupRequestToken,
  state: MatchupLifecycleState
): boolean {
  return (
    token.generation === state.generation &&
    areSameMatchupSession(token.owner, state.current) &&
    token.owner.gameId !== null &&
    token.owner.gameId === state.current?.gameId
  )
}

/** 选人数据若直接给出唯一敌方分路，优先于概率先验。 */
export function resolveAssignedLaneOpponent(
  enemies: readonly AssignedOpponentLike[],
  lane: LaneName | ''
): number | null {
  if (!lane) return null
  const matches = new Set<number>()
  for (const enemy of enemies) {
    if (
      String(enemy.assignedPosition ?? '')
        .trim()
        .toLowerCase() !== lane
    )
      continue
    const id = championId(enemy.championId) ?? championId(enemy.championPickIntent)
    if (id) matches.add(id)
  }
  return matches.size === 1 ? [...matches][0] : null
}

/**
 * 游戏内真实分路校验：位置未齐时必须等待；只有唯一同路敌人出现后，
 * 才能确认原推测或要求改为真实对手。
 */
export function resolveRealMatchupValidation(
  enemies: readonly RealTeamOpponentLike[],
  lane: LaneName | '',
  expectedOpponentChampionId: unknown
): RealMatchupValidation {
  if (!lane) return { status: 'waiting', opponentChampionId: null }
  const matches = new Set<number>()
  for (const enemy of enemies) {
    const selected = String(enemy.selectedPosition ?? '').trim()
    const position = selected || String(enemy.position ?? '').trim()
    if (position.toLowerCase() !== lane) continue
    const id = championId(enemy.championId)
    if (id) matches.add(id)
  }
  if (matches.size !== 1) return { status: 'waiting', opponentChampionId: null }
  const actualOpponentChampionId = [...matches][0]
  return {
    status:
      actualOpponentChampionId === championId(expectedOpponentChampionId)
        ? 'confirmed'
        : 'corrected',
    opponentChampionId: actualOpponentChampionId
  }
}

/** 修正请求失败时不能保留旧对手锁，也不能由轮询每 3 秒重复轰击。 */
export function resolveMatchupCorrectionDisposition(input: {
  requestSequence: number
  currentSequence: number
  applied: boolean
}): MatchupCorrectionDisposition {
  if (input.requestSequence !== input.currentSequence) return 'superseded'
  return input.applied ? 'applied' : 'drop-stale-lock'
}
