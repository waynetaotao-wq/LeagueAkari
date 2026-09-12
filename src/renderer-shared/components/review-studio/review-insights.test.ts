import { describe, expect, it } from 'vitest'

import { parseReviewMatch } from './analysis'
import { getReviewOverview } from './review-insights'
import { createReviewFixture } from './test-fixtures'

function match() {
  const fixture = createReviewFixture()
  const parsed = parseReviewMatch(
    fixture.summary,
    fixture.details,
    fixture.puuid,
    fixture.sgpServerId
  )
  if (!parsed.ok) throw new Error(parsed.reason)
  return parsed.match
}

describe('match review overview', () => {
  it('uses 15 minutes when present, labels the actual fallback and preserves an unknown comparison', () => {
    const model = match()
    expect(getReviewOverview(model)).toMatchObject({
      checkpoint: { minute: 15, timestamp: 900_000 },
      direction: 'ahead'
    })
    model.snapshots[1] = {
      minute: 15,
      timestamp: null,
      personalGoldDiff: null,
      personalCsDiff: null,
      teamGoldDiff: null
    }
    expect(getReviewOverview(model).checkpoint?.minute).toBe(10)
    model.snapshots[0].personalGoldDiff = null
    expect(getReviewOverview(model)).toMatchObject({
      checkpoint: { minute: 10 },
      direction: 'unknown'
    })
    model.snapshots[0].teamGoldDiff = null
    expect(getReviewOverview(model)).toMatchObject({ checkpoint: null, direction: 'unknown' })
  })

  it('distinguishes an actual zero from a missing or negative gold difference', () => {
    const model = match()
    model.snapshots[1].personalGoldDiff = 0
    expect(getReviewOverview(model).direction).toBe('even')
    model.snapshots[1].personalGoldDiff = -500
    expect(getReviewOverview(model).direction).toBe('behind')
  })
})
