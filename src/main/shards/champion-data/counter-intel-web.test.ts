import { describe, expect, it } from 'vitest'

import { buildCounterPageUrl } from './counter-intel-web'

describe('buildCounterPageUrl', () => {
  it('binds the lane-kill page to region, tier, patch and target', () => {
    expect(
      buildCounterPageUrl({
        slug: 'gwen',
        position: 'top',
        region: 'kr',
        tier: 'emerald_plus',
        patch: '16.17',
        targetSlug: 'gangplank'
      })
    ).toBe(
      'https://op.gg/lol/champions/gwen/counters/top?region=kr&tier=emerald_plus&patch=16.17&target_champion=gangplank'
    )
  })

  it('omits the patch only for the explicit latest-patch scope', () => {
    const url = buildCounterPageUrl({
      slug: 'gwen',
      position: 'top',
      region: 'kr',
      tier: 'emerald_plus',
      patch: null,
      targetSlug: 'gangplank'
    })

    expect(url).not.toContain('patch=')
  })
})
