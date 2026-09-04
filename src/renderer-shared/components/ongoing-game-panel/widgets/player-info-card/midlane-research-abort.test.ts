import { describe, expect, it } from 'vitest'

import { type MidLiteGame, analyzeDeep, collectVersionLadder } from './midlane-research'

const participantTeams = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [i + 1, i < 5 ? 100 : 200])
)
const games: MidLiteGame[] = Array.from({ length: 30 }, (_, i) => ({
  gameId: i + 1,
  gameCreation: 1_700_000_000_000 - i,
  gameVersion: '16.17',
  gameDuration: 1800,
  win: true,
  selfPid: 3,
  teamId: 100,
  enemyMidPid: 8,
  participantTeams
}))

function validTimeline() {
  return {
    frames: Array.from({ length: 15 }, (_, minute) => ({
      timestamp: minute * 60_000,
      participantFrames: { 3: { level: 5, position: { x: 7400, y: 7400 } } },
      events: []
    }))
  }
}

/** 中止返回明确的 AbortError；停止后续分页/排队请求，不把未完成研究当完整结果缓存。 */
describe('midlane research abort contract', () => {
  it('collectVersionLadder stops paging once the signal is aborted', async () => {
    const controller = new AbortController()
    let pages = 0
    const getPage = async () => {
      pages++
      if (pages === 2) controller.abort()
      return {
        games: Array.from({ length: 20 }, (_, i) => ({
          json: {
            gameId: pages * 100 + i,
            gameVersion: '16.17.1',
            gameMode: 'CLASSIC',
            mapId: 11,
            gameCreation: 1_700_000_000_000 - i,
            queueId: 420,
            gameDuration: 1800,
            participants: Array.from({ length: 10 }, (_, p) => ({
              participantId: p + 1,
              puuid: p === 2 ? 'p' : `other-${p}`,
              championId: p === 2 ? 238 : 1,
              teamId: p < 5 ? 100 : 200,
              teamPosition: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][p % 5],
              win: p < 5
            }))
          }
        }))
      }
    }
    await expect(
      collectVersionLadder(
        getPage,
        'p',
        238,
        { target: 500, maxPages: 50 },
        undefined,
        controller.signal
      )
    ).rejects.toThrow()
    expect(pages).toBe(2)
  })

  it('analyzeDeep stops new work and rejects instead of returning an aborted partial result', async () => {
    const controller = new AbortController()
    let fetched = 0
    const getTimeline = async () => {
      fetched++
      if (fetched === 3) controller.abort()
      return validTimeline()
    }
    await expect(
      analyzeDeep(games, getTimeline, { deepGames: 30 }, undefined, controller.signal)
    ).rejects.toThrow()
    expect(fetched).toBe(3)
  })

  it('does not send requests after cancellation while waiting for the shared concurrency limit', async () => {
    let releaseRequests!: () => void
    let occupied!: () => void
    const blocked = new Promise<void>((resolve) => {
      releaseRequests = resolve
    })
    const allOccupied = new Promise<void>((resolve) => {
      occupied = resolve
    })
    let firstCalls = 0
    const first = analyzeDeep(games.slice(0, 5), async () => {
      if (++firstCalls === 5) occupied()
      await blocked
      return validTimeline()
    })
    await allOccupied
    const controller = new AbortController()
    let secondCalls = 0
    const second = analyzeDeep(
      games.slice(0, 5),
      async () => {
        secondCalls++
        return validTimeline()
      },
      undefined,
      undefined,
      controller.signal
    )
    const cancelled = expect(second).rejects.toThrow()
    controller.abort()
    releaseRequests()
    await first
    await cancelled
    expect(secondCalls).toBe(0)
  })
})
