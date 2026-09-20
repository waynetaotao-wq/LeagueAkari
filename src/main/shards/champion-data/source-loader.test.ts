import { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import axios from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { ChampionDataMainSourceLoader } from './source-loader'

function setup(responseOverride?: (body: any) => void) {
  const requests: { url?: string; params: any }[] = []
  const body: any = {
    meta: { version: '16.18', cached_at: '2026-09-20T00:00:00Z' },
    data: {
      summary: {
        id: 103,
        average_stats: null,
        positions: [
          {
            name: 'MID',
            counters: [],
            stats: {
              play: 7,
              win_rate: 4 / 7,
              pick_rate: 0.1,
              ban_rate: 0.02,
              kda: 2,
              role_rate: 1,
              tier_data: { tier: 2, rank: 4, rank_prev: 5 }
            }
          }
        ]
      },
      skill_masteries: [
        {
          ids: ['Q', 'W', 'E'],
          play: 70,
          win: 40,
          pick_rate: 0.9,
          builds: [{ order: ['W', 'Q', 'E'], play: 7, win: 6, pick_rate: 0.2 }]
        }
      ],
      core_items: [],
      starter_items: [],
      boots: [],
      last_items: []
    }
  }
  responseOverride?.(body)
  const api = new OpggHttpApiAxiosHelper(
    axios.create({
      adapter: async (config) => {
        requests.push({ url: config.url, params: config.params })
        return { data: body, config, status: 200, statusText: 'OK', headers: {} }
      }
    })
  )
  const loader = new ChampionDataMainSourceLoader(
    { warn: vi.fn() } as any,
    api,
    {} as any,
    {} as any,
    {} as any
  )
  return { loader, requests, body }
}
const query = {
  source: 'opgg',
  mode: 'ranked',
  region: 'na',
  tier: 'diamond_plus',
  patch: '16.18',
  position: 'middle'
} as const

describe('champion data source integrity', () => {
  it('carries the selected region, tier, lane and patch to OP.GG and retains mastery statistics', async () => {
    const { loader, requests } = setup()
    const data = await loader.loadDetails('opgg', query, 103)
    expect(requests).toEqual([
      {
        url: '/api/na/champions/ranked/103/mid',
        params: { tier: 'diamond_plus', version: '16.18', target_champion: undefined }
      }
    ])
    expect(data?.summary?.performance.winRate).toBeCloseTo(4 / 7)
    expect(data?.sections.abilityBuilds?.[0]).toMatchObject({
      priorityPerformance: { games: 70, wins: 40 },
      performance: { games: 7, wins: 6 }
    })
  })

  it.each(['patch', 'champion', 'position'])(
    'rejects a different %s returned by the provider',
    async (field) => {
      const { loader } = setup((body) => {
        if (field === 'patch') body.meta.version = '16.17'
        if (field === 'champion') body.data.summary.id = 238
        if (field === 'position') body.data.summary.positions[0].name = 'TOP'
      })
      await expect(loader.loadDetails('opgg', query, 103)).rejects.toThrow(/OP.GG/)
    }
  )

  it('excludes other lanes from the filtered overview and rejects an unexpected patch', async () => {
    const { loader, body } = setup()
    const item = body.data.summary
    body.data = [item, { ...item, id: 86, positions: [{ ...item.positions[0], name: 'TOP' }] }]
    const overview = await loader.loadOverview('opgg', query)
    expect(overview.sections.champions.map((c) => c.championId)).toEqual([103])
    body.meta.version = '16.17'
    await expect(loader.loadOverview('opgg', query)).rejects.toThrow(/patch/)
  })
})
