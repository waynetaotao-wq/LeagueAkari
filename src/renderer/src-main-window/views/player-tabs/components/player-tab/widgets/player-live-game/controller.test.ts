import type { Friend } from '@shared/types/league-client/chat'
import { describe, expect, it, vi } from 'vitest'

import { PlayerLiveGameController } from './controller'

const identity = { puuid: 'target', sgpServerId: 'TEST', crossRegion: false }
const game = (id = 101, puuid = 'target') => ({
  game: {
    id,
    gameState: 'IN_PROGRESS',
    gameQueueConfigId: 420,
    teamOne: [{ puuid, championId: 238 }],
    teamTwo: []
  },
  playerCredentials: { encryptionKey: 'never-launch-with-this' }
})
const friend = (id = 101, key = 'fresh-key') =>
  ({
    puuid: 'target',
    availability: 'dnd',
    lol: {
      gameStatus: 'inGame',
      gameId: String(id),
      championId: '238',
      queueId: '420',
      spectatorKey: key
    }
  }) as Friend
function setup() {
  const deps = {
    getGame: vi.fn().mockResolvedValue(game()),
    getFriends: vi.fn().mockResolvedValue([friend()]),
    launch: vi.fn().mockResolvedValue(undefined),
    canLaunch: vi.fn(() => true),
    publish: vi.fn()
  }
  return { deps, controller: new PlayerLiveGameController(deps) }
}
describe('summoner current game and spectator flow', () => {
  it('returns a verified game without exposing credentials, then obtains a fresh grant for launch', async () => {
    const { deps, controller } = setup()
    const state = await controller.refresh(identity)
    expect(state).toMatchObject({
      status: 'in-game',
      source: 'sgp',
      gameId: 101,
      canSpectate: true
    })
    expect(JSON.stringify(state)).not.toContain('key')
    deps.getFriends.mockResolvedValue([friend(101, 'rotated-key')])
    expect(await controller.spectate(identity, 101)).toBe(true)
    expect(deps.launch).toHaveBeenCalledWith('target', 'rotated-key')
  })
  it.each([403, 404, 500])(
    'keeps HTTP %s as unknown instead of declaring not in game',
    async (status) => {
      const { deps, controller } = setup()
      deps.getGame.mockRejectedValue({ response: { status } })
      deps.getFriends.mockResolvedValue([])
      expect(await controller.refresh(identity)).toMatchObject({
        status: 'unknown',
        canSpectate: false
      })
    }
  )
  it('rejects the wrong player, contradictory games, cross-region grants and a game that ended', async () => {
    const { deps, controller } = setup()
    deps.getGame.mockResolvedValue(game(101, 'other'))
    deps.getFriends.mockResolvedValue([])
    expect(await controller.refresh(identity)).toMatchObject({ status: 'unknown' })
    deps.getGame.mockResolvedValue(game(102))
    deps.getFriends.mockResolvedValue([friend(101)])
    expect(await controller.refresh(identity)).toMatchObject({
      status: 'in-game',
      gameId: 102,
      canSpectate: false
    })
    expect(await controller.spectate({ ...identity, crossRegion: true }, 102)).toBe(false)
    deps.getGame.mockResolvedValue({ game: null })
    deps.getFriends.mockResolvedValue([
      { ...friend(), lol: { ...friend().lol, gameStatus: 'outOfGame' } }
    ])
    expect(await controller.spectate(identity, 102)).toBe(false)
    expect(deps.launch).not.toHaveBeenCalled()
  })
  it('discards a late result after switching player tabs', async () => {
    const { deps, controller } = setup()
    let finish!: (value: unknown) => void
    deps.getGame.mockImplementationOnce(() => new Promise((r) => (finish = r)))
    const old = controller.refresh(identity)
    await Promise.resolve()
    controller.stop()
    finish(game())
    expect(await old).toBeNull()
    expect(deps.publish.mock.lastCall?.[0]).toMatchObject({
      status: 'unknown',
      canSpectate: false,
      gameId: null
    })
  })
  it('leaves malformed or ambiguous identity data unconfirmed', async () => {
    const { deps, controller } = setup()
    deps.getGame.mockResolvedValue({ game: { ...game().game, teamTwo: game().game.teamOne } })
    deps.getFriends.mockResolvedValue({ unexpected: true })
    expect(await controller.refresh(identity)).toMatchObject({
      status: 'unknown',
      canSpectate: false
    })
    deps.getFriends.mockResolvedValue([friend(), friend(999)])
    expect(await controller.refresh(identity)).toMatchObject({
      status: 'unknown',
      canSpectate: false
    })
  })
  it('ends loading after ten seconds even when a transport ignores cancellation', async () => {
    vi.useFakeTimers()
    try {
      const { deps, controller } = setup()
      deps.getGame.mockImplementation(() => new Promise(() => {}))
      const pending = controller.refresh(identity)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await pending).toMatchObject({ status: 'unknown', loading: false, canSpectate: false })
      controller.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
