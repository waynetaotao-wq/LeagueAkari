import type { AutoReportCategory, AutoReportScope } from '@shared/shards/auto-gameflow'
import { AxiosError } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AutoGameflowReportController } from './report-controller'
import type { ReportTarget } from './report-logic'

interface ReportRunSettings {
  scope: AutoReportScope
  categories: AutoReportCategory[]
}

interface TestableReportController {
  _runForGame(
    ballotGameId: number | null,
    ballotTargets: ReportTarget[],
    runSettings: ReportRunSettings
  ): Promise<void>
}

const eogStats = {
  gameId: 111,
  reportGameId: 222,
  localPlayer: { puuid: 'self' },
  teams: [
    {
      isPlayerTeam: true,
      players: [{ puuid: 'self', summonerId: 1, isLocalPlayer: true, gameId: 222 }]
    },
    {
      players: [{ puuid: 'enemy', summonerId: 2, summonerName: 'Enemy', gameId: 222 }]
    }
  ]
}

function createHarness(friendReadFails = false) {
  let summary = ''
  const get = vi.fn(async (url: string) => {
    if (url === '/lol-end-of-game/v1/eog-stats-block') {
      return { data: eogStats }
    }
    if (url === '/lol-chat/v1/friends') {
      if (friendReadFails) {
        throw new Error('friends unavailable')
      }
      return { data: [] }
    }
    if (url === '/lol-lobby/v2/party/eog-status') {
      return {
        data: { eogPlayers: ['self'], leftPlayers: [], partySize: 1, readyPlayers: [] }
      }
    }
    if (url === '/lol-player-report-sender/v1/reported-players/gameId/111') {
      return { data: [] }
    }
    throw new Error(`unexpected GET ${url}`)
  })
  const post = vi.fn(async () => ({ data: null }))
  const context = {
    leagueClient: {
      data: {
        gameflow: {
          phase: 'EndOfGame',
          session: {
            gameData: {
              gameId: 111,
              isCustomGame: false,
              queue: { gameMode: 'CLASSIC', maximumParticipantListSize: 2 },
              teamOne: [{ puuid: 'self' }],
              teamTwo: [{ puuid: 'enemy' }]
            }
          }
        },
        summoner: { me: { puuid: 'self' } }
      },
      http: { get, post }
    },
    logger: { info: vi.fn(), warn: vi.fn() },
    settings: {
      autoReportEnabled: true,
      autoReportScope: 'opponents-only',
      autoReportCategories: ['VERBAL_ABUSE']
    },
    state: {
      setLastAutoReportSummary(value: string) {
        summary = value
      }
    }
  }
  const controller = new AutoGameflowReportController(context as never)
  const runForGame = (controller as unknown as TestableReportController)._runForGame.bind(
    controller
  )

  return { context, controller, get, post, runForGame, summary: () => summary }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AutoGameflowReportController orchestration', () => {
  it('uses the stats ID for dedupe GET and the report ID for the sequential POST', async () => {
    vi.useFakeTimers()
    const { get, post, runForGame, summary } = createHarness()

    const run = runForGame(222, [], {
      scope: 'opponents-only',
      categories: ['VERBAL_ABUSE']
    })
    await vi.runAllTimersAsync()
    await run

    expect(get).toHaveBeenCalledWith(
      '/lol-player-report-sender/v1/reported-players/gameId/111',
      expect.objectContaining({ timeout: 2000, 'axios-retry': { retries: 0 } })
    )
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(
      '/lol-player-report-sender/v1/end-of-game-reports',
      {
        gameId: 222,
        offenderPuuid: 'enemy',
        offenderSummonerId: 2,
        categories: ['VERBAL_ABUSE'],
        comment: ''
      },
      expect.objectContaining({ timeout: 17_500, 'axios-retry': { retries: 0 } })
    )
    expect(summary()).toBe('上一局：已举报 1 人（仅敌方）')
  })

  it('fails closed with zero POSTs when the friend safety read never succeeds', async () => {
    vi.useFakeTimers()
    const { post, runForGame, summary } = createHarness(true)

    const run = runForGame(222, [], {
      scope: 'opponents-only',
      categories: ['VERBAL_ABUSE']
    })
    await vi.runAllTimersAsync()
    await run

    expect(post).not.toHaveBeenCalled()
    expect(summary()).toBe('上一局：好友列表获取失败，为避免误伤好友已跳过')
  })

  it('keeps local dedupe when a 429 response is followed by cancellation before verification', async () => {
    vi.useFakeTimers()
    const { context, controller, post, runForGame } = createHarness()
    post.mockImplementationOnce(async () => {
      context.leagueClient.data.gameflow.phase = 'Lobby'
      throw Object.assign(new AxiosError('rate limited'), {
        response: { status: 429, headers: {}, data: {} }
      })
    })

    const run = runForGame(222, [], {
      scope: 'opponents-only',
      categories: ['VERBAL_ABUSE']
    })
    await vi.runAllTimersAsync()
    await run

    const handledTargets = (
      controller as unknown as { _locallyHandledTargetIds: Map<string, Set<string>> }
    )._locallyHandledTargetIds
    expect(post).toHaveBeenCalledTimes(1)
    expect(handledTargets.get('111:222')).toContain('enemy')
  })
})
