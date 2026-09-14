import type { AxiosInstance } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { buildCounterPageUrl, fetchLaneKillRates } from './counter-intel-web'

const scope = {
  baseSlug: 'lux',
  position: 'middle' as const,
  region: 'kr',
  tier: 'emerald_plus',
  patch: '16.18',
  targets: [{ championId: 238, slug: 'zed' }]
}

function counterPage(locale: string, query: Partial<Record<string, string>> = {}) {
  const element = (props: unknown) => ['$', 'span', null, props]
  return [
    element({
      sub: 'ranked',
      detail: 'counters',
      params: {
        game_region: 'kr',
        game_tier: 'emerald_plus',
        game_patch_version: '16.18',
        game_position: 'mid'
      }
    }),
    element({
      href: {
        pathname: `${locale}/lol/champions/zed/counters/mid`,
        query: {
          region: 'kr',
          tier: 'emerald_plus',
          patch: '16.18',
          target_champion: 'lux',
          ...query
        }
      }
    }),
    [
      element({ children: '46.18%' }),
      element({ children: 'Lane kill rate' }),
      element({ children: '53.82%' })
    ]
  ]
    .map((value, index) => `${index}:${JSON.stringify(value)}`)
    .join('\n')
}

describe('localized lane-kill responses', () => {
  it.each(['', '/zh-cn', '/ko'])(
    'keeps the same verified matchup for locale %s',
    async (locale) => {
      const http = {
        get: vi.fn().mockResolvedValue({ data: counterPage(locale) })
      } as unknown as AxiosInstance

      const rates = await fetchLaneKillRates(http, scope)

      expect(rates.get(238)).toEqual({ enemyPercent: 46.18, minePercent: 53.82 })
    }
  )

  it.each([{ target_champion: 'ahri' }, { region: 'global' }, { patch: '16.17' }, { tier: 'all' }])(
    'still rejects mismatched localized statistics: %j',
    async (query) => {
      const http = {
        get: vi.fn().mockResolvedValue({ data: counterPage('/zh-cn', query) })
      } as unknown as AxiosInstance

      const rates = await fetchLaneKillRates(http, scope)

      expect(rates.get(238)).toBeNull()
    }
  )
})

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
