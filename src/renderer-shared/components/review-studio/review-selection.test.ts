import { describe, expect, it } from 'vitest'

import type { ReviewCandidate } from './data-loader'
import { getReviewDefaultContext } from './review-selection'

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
