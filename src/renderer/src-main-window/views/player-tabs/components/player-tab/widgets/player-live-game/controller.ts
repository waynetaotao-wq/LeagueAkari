import type { Friend } from '@shared/types/league-client/chat'

export interface LiveGameIdentity {
  puuid: string
  sgpServerId: string
  crossRegion: boolean
}
export interface PlayerLiveGameState {
  status: 'unknown' | 'in-game' | 'not-in-game'
  source: 'sgp' | 'friend' | null
  checkedAt: number | null
  gameId: number | null
  championId: number | null
  queueId: number | null
  canSpectate: boolean
  loading: boolean
}
export const emptyLiveGameState = (): PlayerLiveGameState => ({
  status: 'unknown',
  source: null,
  checkedAt: null,
  gameId: null,
  championId: null,
  queueId: null,
  canSpectate: false,
  loading: false
})
type SpectatorGrant = { gameId: number; puuid: string; key: string }
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const positiveId = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null
}

export class PlayerLiveGameController {
  private _generation = 0
  private _abort: AbortController | null = null
  private _grant: SpectatorGrant | null = null
  private _state = emptyLiveGameState()

  constructor(
    private readonly _deps: {
      getGame: (identity: LiveGameIdentity, signal: AbortSignal) => Promise<unknown>
      getFriends: (signal: AbortSignal) => Promise<Friend[]>
      launch: (puuid: string, key: string) => Promise<unknown>
      canLaunch: () => boolean
      publish: (state: PlayerLiveGameState) => void
    }
  ) {}

  stop() {
    this._generation++
    this._abort?.abort()
    this._abort = null
    this._grant = null
    this._state = emptyLiveGameState()
    this._deps.publish(this._state)
  }

  async refresh(identity: LiveGameIdentity): Promise<PlayerLiveGameState | null> {
    this.stop()
    const generation = this._generation
    const abort = new AbortController()
    this._abort = abort
    const timer = setTimeout(() => abort.abort(), 10_000)
    let finishAbort!: () => void
    const aborted = new Promise<null>((resolve) => {
      finishAbort = () => resolve(null)
    })
    abort.signal.addEventListener('abort', finishAbort, { once: true })
    this._state = { ...emptyLiveGameState(), loading: true }
    this._deps.publish(this._state)
    try {
      const results = await Promise.race([
        Promise.allSettled([
          Promise.resolve().then(() => this._deps.getGame(identity, abort.signal)),
          identity.crossRegion
            ? Promise.resolve([])
            : Promise.resolve().then(() => this._deps.getFriends(abort.signal))
        ]),
        aborted
      ])
      if (generation !== this._generation) return null
      const next = { ...emptyLiveGameState(), checkedAt: Date.now() }
      if (!results) {
        this._state = next
        this._deps.publish(next)
        return next
      }
      const [gameResult, friendsResult] = results
      const payload = gameResult.status === 'fulfilled' ? gameResult.value : null
      if (record(payload) && record(payload.game)) {
        const game = payload.game
        const players = [game.teamOne, game.teamTwo].flatMap((team) =>
          Array.isArray(team) ? team : []
        )
        const matches = players.filter((p) => record(p) && p.puuid === identity.puuid)
        const player = matches.length === 1 ? matches[0] : null
        const gameId = positiveId(game.id)
        // Missing/hidden participants, unknown states and 404/403 are never proof of being offline.
        if (gameId && record(player) && game.gameState === 'IN_PROGRESS') {
          Object.assign(next, {
            status: 'in-game',
            source: 'sgp',
            gameId,
            championId: positiveId(player.championId),
            queueId: positiveId(game.gameQueueConfigId)
          })
        }
      }
      const friends =
        friendsResult.status === 'fulfilled' && Array.isArray(friendsResult.value)
          ? friendsResult.value.filter(
              (f) => record(f) && (f.puuid || f.lol?.puuid) === identity.puuid
            )
          : []
      const friend = friends.length === 1 ? friends[0] : undefined
      if (friend?.lol && friend.availability !== 'offline') {
        const gameId = positiveId(friend.lol.gameId)
        const gameStatus =
          typeof friend.lol.gameStatus === 'string' ? friend.lol.gameStatus.toLowerCase() : ''
        if (gameStatus === 'ingame' && gameId && friend.availability === 'dnd') {
          // A conflicting server game and presence game cannot grant a spectator launch.
          if (next.status === 'unknown')
            Object.assign(next, {
              status: 'in-game',
              source: 'friend',
              gameId,
              championId: positiveId(friend.lol.championId),
              queueId: positiveId(friend.lol.queueId)
            })
          if (
            next.gameId === gameId &&
            typeof friend.lol.spectatorKey === 'string' &&
            friend.lol.spectatorKey.trim()
          ) {
            this._grant = { gameId, puuid: identity.puuid, key: friend.lol.spectatorKey }
            next.canSpectate = true
          }
        } else if (
          next.status === 'unknown' &&
          ['outofgame', 'inlobby', 'inqueue', 'championselect'].includes(gameStatus)
        ) {
          Object.assign(next, { status: 'not-in-game', source: 'friend' })
        }
      }
      if (abort.signal.aborted) {
        this._grant = null
        Object.assign(next, emptyLiveGameState(), { checkedAt: Date.now() })
      }
      this._state = next
      this._deps.publish(next)
      return next
    } finally {
      clearTimeout(timer)
      abort.signal.removeEventListener('abort', finishAbort)
      if (this._abort === abort) this._abort = null
    }
  }

  async spectate(identity: LiveGameIdentity, expectedGameId: number): Promise<boolean> {
    if (!this._deps.canLaunch() || identity.crossRegion) return false
    const refreshed = await this.refresh(identity)
    const grant = this._grant
    if (
      !refreshed ||
      refreshed.gameId !== expectedGameId ||
      !refreshed.canSpectate ||
      !grant ||
      grant.puuid !== identity.puuid ||
      grant.gameId !== expectedGameId ||
      !this._deps.canLaunch()
    )
      return false
    // Pass only the fresh client-issued spectator key. Never substitute SGP player encryption keys.
    await this._deps.launch(grant.puuid, grant.key)
    return true
  }
}
