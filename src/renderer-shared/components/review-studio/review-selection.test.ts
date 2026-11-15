import { describe, expect, it } from 'vitest'

import type { ReviewCandidate } from './data-loader'
import { getReviewBroadenOffer, getReviewDefaultContext } from './review-selection'
import type { ReviewFilter, ReviewMatch } from './types'

function record(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    gameId: 1,
    championId: 238,
    position: 'MIDDLE',
    opponentChampionId: 103,
    queueId: 420,
    patch: '16.17',
    gameCreation: 100,
    win: true,
    ...overrides
  }
}

describe('review history default selection', () => {
  it('selects Zed middle when available and keeps the latest actual solo queue patch', () => {
    const context = getReviewDefaultContext([
      record({ gameId: 4, championId: 103, gameCreation: 400, patch: '16.19' }),
      record({ gameId: 3, gameCreation: 300, queueId: 440, patch: '16.18' }),
      record({ gameId: 2, gameCreation: 200 }),
      record({ patch: '16.16' })
    ])
    expect(context).toEqual({ championId: 238, position: 'MIDDLE', queueId: 420, patch: '16.17' })
  })

  it('honors the selected hero and actual role without mixing another role’s queue', () => {
    expect(
      getReviewDefaultContext(
        [
          record(),
          record({ gameId: 2, position: 'TOP', queueId: 440, patch: '16.18', gameCreation: 200 })
        ],
        238,
        'TOP'
      )
    ).toEqual({ championId: 238, position: 'TOP', queueId: 440, patch: '16.18' })
  })

  it('uses actual recent records when the preferred champion or role is absent', () => {
    expect(
      getReviewDefaultContext(
        [record({ championId: 64, position: 'JUNGLE', queueId: 400 })],
        999,
        'MIDDLE'
      )
    ).toEqual({ championId: 64, position: 'JUNGLE', queueId: 400, patch: '16.17' })
    expect(getReviewDefaultContext([])).toBeNull()
  })
})

describe('review filter broadening offer', () => {
  const narrow: ReviewFilter = {
    championId: 238,
    position: 'MIDDLE',
    opponentChampionId: null,
    queueId: 420,
    patch: '16.17'
  }
  /** A game already analyzed and kept on this device. */
  const stored = (overrides: Partial<ReviewCandidate> = {}) =>
    ({
      meta: { ...record(overrides), sgpServerId: 'TEST', puuid: 'player' }
    }) as unknown as ReviewMatch

  it('offers to analyze history that the queue and patch filter leaves out', () => {
    const candidates = [
      record({ gameId: 1 }),
      record({ gameId: 2 }),
      record({ gameId: 3, queueId: 440 }),
      record({ gameId: 4, patch: '16.16' }),
      record({ gameId: 5, championId: 103 }),
      record({ gameId: 6, position: 'TOP' })
    ]
    // Other champions and roles are never pulled in by widening.
    expect(getReviewBroadenOffer(narrow, candidates, [])).toEqual({
      mode: 'analyze',
      current: 2,
      total: 4,
      limit: 20
    })
  })

  it('treats an opponent restriction as something to drop', () => {
    const candidates = [record({ gameId: 1 }), record({ gameId: 2, opponentChampionId: 61 })]
    expect(
      getReviewBroadenOffer(
        { championId: 238, position: 'MIDDLE', opponentChampionId: 103 },
        candidates,
        []
      )
    ).toEqual({ mode: 'analyze', current: 1, total: 2, limit: 20 })
  })

  it('picks the smallest batch that covers the widened history, capped at 60', () => {
    const limitFor = (count: number) => {
      const history = Array.from({ length: count }, (_, index) =>
        record({ gameId: index + 1, queueId: index === 0 ? 420 : 440 })
      )
      const offer = getReviewBroadenOffer(narrow, history, [])
      return offer?.mode === 'analyze' ? offer.limit : null
    }
    expect([20, 21, 40, 41, 75].map(limitFor)).toEqual([20, 40, 40, 60, 60])
  })

  it('offers to show stored games hidden by the filter when history adds nothing', () => {
    const kept = [
      stored({ gameId: 1 }),
      stored({ gameId: 1 }), // the same game held by this session and by the archive
      stored({ gameId: 2, queueId: 440 }),
      stored({ gameId: 3, patch: '16.16' }),
      stored({ gameId: 4, championId: 103 })
    ]
    expect(getReviewBroadenOffer(narrow, [], kept)).toEqual({ mode: 'show', current: 1, total: 3 })
    // Unanalyzed history takes precedence over stored games.
    expect(
      getReviewBroadenOffer(
        narrow,
        [record({ gameId: 9 }), record({ gameId: 10, queueId: 440 })],
        kept
      )
    ).toEqual({ mode: 'analyze', current: 1, total: 2, limit: 20 })
  })

  it('stays silent when nothing is restricted or widening adds nothing', () => {
    const candidates = [record({ gameId: 1 }), record({ gameId: 2, queueId: 440 })]
    expect(
      getReviewBroadenOffer({ championId: 238, position: 'MIDDLE' }, candidates, [
        stored({ gameId: 3, queueId: 440 })
      ])
    ).toBeNull()
    expect(
      getReviewBroadenOffer(narrow, [record({ gameId: 1 })], [stored({ gameId: 1 })])
    ).toBeNull()
    expect(
      getReviewBroadenOffer({ championId: null, position: 'MIDDLE', queueId: 420 }, candidates, [])
    ).toBeNull()
  })
})
