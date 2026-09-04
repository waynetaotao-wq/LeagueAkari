import { useMatchRatingStore } from '@renderer-shared/shards/match-rating/store'
import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { provide, ref } from 'vue'

import { type MatchCardContext, provideMatchCard } from './context'
import { AKARI_POSITION_WEIGHTS, type AkariMetricKey } from './utils/akari-score'
import { buildStoredCalibration } from './utils/akari-score-calibrate-runner'
import { fitAkariWeights } from './utils/akari-score-calibration'

// Keep Vue's real computed/reactivity; only intercept the setup-only injection boundary.
vi.mock('vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue')>()),
  provide: vi.fn()
}))
vi.mock('@shared/data-adapter/match-history/frames', () => ({ toFrames: () => [] }))
vi.mock('@shared/data-adapter/match-history/teams', () => ({
  toTeams: () => ({ teamStatMap: {} })
}))

const positions = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const

function fixture(): LcuOrSgpGameSummary {
  const participants = Array.from({ length: 10 }, (_, i) => ({
    puuid: `player-${i}`,
    participantId: i + 1,
    teamId: i < 5 ? 100 : 200,
    teamPosition: positions[i % 5],
    win: i < 5,
    kills: 4,
    deaths: 4,
    assists: 5,
    championId: 238,
    totalDamageDealtToChampions: i === 2 ? 40000 : 15000,
    totalDamageTaken: 18000,
    goldEarned: i === 2 ? 8000 : 13000,
    neutralMinionsKilled: i % 5 === 1 ? 120 : 0,
    totalMinionsKilled: i % 5 === 4 ? 20 : 180,
    visionScore: 20,
    timeCCingOthers: 25,
    damageDealtToTurrets: 1000,
    doubleKills: 0,
    tripleKills: 0,
    quadraKills: 0,
    pentaKills: 0,
    gameEndedInEarlySurrender: false,
    gameEndedInSurrender: false,
    challenges: { soloKills: 0 }
  }))
  return {
    source: 'sgp',
    gameId: 42,
    data: {
      json: {
        gameId: 42,
        gameDuration: 1800,
        gameMode: 'CLASSIC',
        mapId: 11,
        queueId: 420,
        gameVersion: '16.17',
        gameCreation: 0,
        gameType: 'MATCHED_GAME',
        participants
      }
    }
  } as unknown as LcuOrSgpGameSummary
}

describe('match card rating calibration reactivity', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(provide).mockClear()
  })

  it('recomputes an existing card immediately after saving and resetting weights', () => {
    const summary = ref(fixture())
    provideMatchCard({
      summary,
      isExpanded: ref(false),
      puuid: ref('player-2'),
      details: ref(null),
      hidePrivacy: ref(false),
      loadingDetails: ref(false),
      replayState: ref(null),
      canDryRunOngoingGame: ref(false),
      navigateToSummonerByPuuid: vi.fn(),
      loadReplay: vi.fn(),
      watchReplay: vi.fn(),
      loadDetails: vi.fn(),
      dryRunOngoingGame: vi.fn()
    })
    const context = vi.mocked(provide).mock.calls.at(-1)![1] as MatchCardContext
    const originalSummary = summary.value
    const initial = context.akariScores.value.byPuuid.get('player-2')!.rating
    const stored = buildStoredCalibration(
      { ...fitAkariWeights([]), trainingGames: 20, validation: null },
      20
    )
    stored.weights = structuredClone(AKARI_POSITION_WEIGHTS)
    for (const key of Object.keys(stored.weights.MIDDLE) as AkariMetricKey[]) {
      stored.weights.MIDDLE[key] = key === 'damage' ? 1 : 0
    }
    const store = useMatchRatingStore()
    store.settings.calibration = JSON.stringify(stored)
    expect(context.akariScores.value.byPuuid.get('player-2')!.rating).not.toBe(initial)
    expect(summary.value).toBe(originalSummary)
    store.settings.calibration = null
    expect(context.akariScores.value.byPuuid.get('player-2')!.rating).toBe(initial)
  })
})
