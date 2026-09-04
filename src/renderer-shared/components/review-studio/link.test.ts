import { describe, expect, it } from 'vitest'

import { buildReviewStudioLink, parseReviewStudioLink } from './link'

describe('review studio navigation', () => {
  it('preserves player, region and selected match across renderer windows', () => {
    const target = {
      puuid: 'player-123',
      sgpServerId: 'TENCENT_HN1',
      gameId: 87654321,
      championId: 238
    }
    expect(parseReviewStudioLink(buildReviewStudioLink(target))).toEqual(target)
    expect(
      parseReviewStudioLink(
        buildReviewStudioLink({ puuid: 'player-123', sgpServerId: 'TENCENT_HN1' })
      )
    ).toEqual({ puuid: 'player-123', sgpServerId: 'TENCENT_HN1' })
  })

  it.each([
    'https://renderer-link/overlays/review-studio?puuid=x&sgpServerId=y',
    'akari://renderer-link/evaluate?puuid=x&sgpServerId=y',
    'akari://renderer-link/overlays/review-studio?puuid=x',
    'akari://renderer-link/overlays/review-studio?puuid=x&sgpServerId=y&gameId=-1',
    'akari://renderer-link/overlays/review-studio?puuid=x&sgpServerId=y&gameId=1.5',
    'akari://renderer-link/overlays/review-studio?puuid=x&sgpServerId=y&gameId=9007199254740992',
    'not a URL'
  ])('ignores invalid or unrelated renderer links: %s', (value) => {
    expect(parseReviewStudioLink(value)).toBeNull()
  })
})
