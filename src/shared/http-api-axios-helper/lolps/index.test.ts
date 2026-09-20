import {
  adaptLolpsChampionDetails,
  adaptLolpsChampionOverview
} from '@shared/data-adapter/champion-data/lolps'
import axios, { type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { toOpggChampionDetailsViewModel } from '../../../renderer/src-opgg-window/opgg/champion-data-view-model'
import { LolpsHttpApiAxiosHelper } from './index'

// Representative public protocol shapes verified against lol.ps on 2026-09-20.
// Small, deliberately uneven counts catch rounding and cross-sample substitutions.
const page = 'versionId:155,description:"26.18";versionId:154,description:"26.17"'
const sequence = ['W', 'Q', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E']
const row = (lane: number) => ({
  championId: 103,
  laneId: lane,
  count: 7,
  winRate: '57.14',
  pickRate: '0.5',
  banRate: '1',
  opTier: 2,
  ranking: 4,
  rankingVariation: -2
})
function payload(config: InternalAxiosRequestConfig): unknown {
  const path = config.url!
  const q = config.params ?? {}
  const identity = {
    regionId: q.region,
    versionId: q.version,
    tierId: q.tier,
    laneId: q.lane,
    championId: q.champion
  }
  if (path === 'https://lol.ps/statistics') return page
  if (path.endsWith('arguments.json')) return { data: { versionId: 155 } }
  if (path.includes('tierlist')) return { data: [row(q.lane)] }
  if (path.endsWith('skill.json'))
    return {
      data: {
        ...identity,
        master: [
          { skillNameList: ['Q', 'W', 'E'], count: 7, winRate: '57.14', pickRate: '99.5' },
          { skillNameList: ['E', 'Q', 'W'], count: 1, winRate: '100', pickRate: '0.5' }
        ],
        lv15: [{ skillNameList: sequence, count: 3, winRate: '66.67', pickRate: '80' }]
      }
    }
  if (path.endsWith('spellitem.json'))
    return {
      data: {
        itemWinrates: {
          ...identity,
          starting: [
            { itemIdList: [[1056], [2003, 2003]], count: 7, winRate: '57.14', pickRate: '0.5' }
          ]
        },
        spellWinrates: {
          0: { spell1Id: 4, spell2Id: 12, count: 7, winRate: '57.14', pickRate: '1' }
        }
      }
    }
  if (path.endsWith('runestatperk.json'))
    return {
      data: {
        runeWinrates: {
          ...identity,
          total: [
            {
              runeCategory1: 8100,
              runeCategory2: 8200,
              category1RuneIdList: [8112, 8139, 8140, 8106],
              category2RuneIdList: [8226, 8210],
              count: 7,
              winRate: '57.14',
              pickRate: '0.5'
            }
          ]
        },
        statperkWinrates: { 0: { statperkIdList: [5005, 5008, 5011], count: 5 } }
      }
    }
  if (path.endsWith('versus.json'))
    return {
      data: {
        counterChampionIdList: [55, 'bad', 238],
        counterWinrateList: [42.86, 10, 50],
        counterCountList: [7, 10, 2]
      }
    }
  throw new Error(`Unexpected endpoint ${path}`)
}
function setup(respond = payload) {
  const requests: InternalAxiosRequestConfig[] = []
  const api = new LolpsHttpApiAxiosHelper(
    axios.create({
      adapter: async (config) => {
        requests.push(config)
        return { data: await respond(config), status: 200, statusText: 'OK', headers: {}, config }
      }
    })
  )
  return { api, requests }
}

describe('LOL.PS filters and published statistics', () => {
  it('keeps missing individual rates and ranks unknown through the detail display', async () => {
    const { api } = setup((config) => {
      if (config.url?.includes('tierlist')) return { data: [{ championId: 103, count: 7 }] }
      return payload(config)
    })
    const raw = await api.getChampion(103, { position: 'middle', version: '26.18' })
    const view = toOpggChampionDetailsViewModel(
      adaptLolpsChampionDetails(raw, { mode: 'ranked', position: 'middle' })
    )
    expect(view.data.summary.positions?.[0].stats).toMatchObject({
      play: 7,
      win_rate: null,
      pick_rate: null,
      ban_rate: null,
      tier_data: { tier: null, rank: null, rank_prev: null }
    })
  })

  it('shows no summary rather than zero-percent wins or an OP tier when the selected lane is unavailable', async () => {
    const { api } = setup((config) =>
      config.url?.includes('tierlist') ? { data: [] } : payload(config)
    )
    const raw = await api.getChampion(103, { position: 'middle', version: '26.18' })
    const view = toOpggChampionDetailsViewModel(
      adaptLolpsChampionDetails(raw, { mode: 'ranked', position: 'middle' })
    )
    expect(view.data.summary.average_stats).toBeNull()
    expect(view.data.summary.positions).toBeNull()
    expect(view.data.summoner_spells).toHaveLength(1)
  })

  it('does not attach an ambiguous level sequence to two different skill priorities', async () => {
    const { api } = setup((config) => {
      const result = payload(config) as any
      if (config.url?.endsWith('skill.json')) {
        result.data.master = [
          ['Q', 'E', 'R'],
          ['Q', 'E', 'W']
        ].map((skillNameList) => ({
          skillNameList,
          count: 10,
          winRate: '50',
          pickRate: '40'
        }))
        result.data.lv15 = [
          {
            skillNameList: [
              'Q',
              'R',
              'W',
              'E',
              'Q',
              'Q',
              'Q',
              'E',
              'Q',
              'E',
              'Q',
              'E',
              'E',
              'E',
              'W'
            ],
            count: 5,
            winRate: '60',
            pickRate: '20'
          }
        ]
      }
      return result
    })
    const result = await api.getChampion(77, { position: 'jungle', version: '26.18' })
    expect(result.data.skill_masteries.map((m) => m.builds)).toEqual([[], []])
    expect(result.data.skill_masteries.map((m) => m.win_rate)).toEqual([0.5, 0.5])
  })

  it.each([
    ['kr', 0, 'bronze_plat', 1],
    ['kr', 0, 'emerald_plus', 2],
    ['kr', 0, 'diamond_plus', 13],
    ['kr', 0, 'master_plus', 3],
    ['na', 3, 'bronze_plat', 1],
    ['na', 3, 'emerald_plus', 2],
    ['na', 3, 'diamond_plus', 13],
    ['na', 3, 'master_plus', 3]
  ] as const)(
    'preserves %s / %s / %s across every detail request',
    async (region, regionId, tier, tierId) => {
      const { api, requests } = setup()
      const response = await api.getChampion(103, {
        region,
        tier,
        version: '26.17',
        position: 'middle'
      })
      const dataRequests = requests.filter((r) => r.url?.startsWith('/'))
      expect(dataRequests).toHaveLength(5)
      for (const request of dataRequests)
        expect(request.params).toMatchObject({
          region: regionId,
          tier: tierId,
          version: 154,
          lane: 2
        })
      expect(response.meta.version).toBe('26.17')
    }
  )

  it('keeps percentage units, precision, direction, and separate mastery/level samples through to display', async () => {
    const { api } = setup()
    const raw = await api.getChampion(103, {
      region: 'na',
      tier: 'diamond_plus',
      position: 'middle'
    })
    const data = adaptLolpsChampionDetails(raw, { mode: 'ranked', position: 'middle' })
    expect(data.metadata.patch).toBe('26.18')
    expect(data.summary?.performance).toMatchObject({
      wins: null,
      winRate: 0.5714,
      pickRate: 0.005,
      banRate: 0.01,
      rankChange: -2
    })
    expect(data.sections.abilityBuilds?.[0]).toMatchObject({
      levelOrder: sequence,
      priorityPerformance: { games: 7, wins: null, winRate: 0.5714 },
      performance: { games: 3, wins: null }
    })
    expect(data.sections.abilityBuilds?.[0].performance.winRate).toBeCloseTo(0.6667, 10)
    expect(data.sections.abilityBuilds?.[1].levelOrder).toEqual([])
    expect(data.sections.matchups).toMatchObject([
      { championId: 55, performance: { games: 7, wins: null, winRate: 0.4286 } },
      { championId: 238, performance: { games: 2, winRate: 0.5 } }
    ])
    const view = toOpggChampionDetailsViewModel(data).data
    for (const stat of [
      view.summoner_spells![0],
      view.runes![0],
      view.starter_items[0],
      view.skill_masteries[0]
    ]) {
      expect(stat.win / stat.play).toBeCloseTo(0.5714, 10)
    }
    expect(view.starter_items[0]).toMatchObject({ ids: [1056, 2003, 2003], pick_rate: 0.005 })
    expect(view.skill_masteries[0].builds[0].order).toEqual(sequence)
    const levels = view.skill_masteries[0].builds[0]
    expect(levels.win / levels.play).toBeCloseTo(0.6667, 10)
  })

  it('keeps lane filters and exposes all five lanes only when explicitly requested', async () => {
    const { api, requests } = setup()
    const raw = await api.getChampions({ region: 'na', tier: 'master_plus', version: '26.18' })
    expect(requests.filter((r) => r.url?.startsWith('/')).map((r) => r.params)).toEqual(
      [0, 1, 2, 3, 4].map((lane) => ({ region: 3, version: 155, tier: 3, lane }))
    )
    expect(
      adaptLolpsChampionOverview(raw, { mode: 'ranked', position: 'all' }).sections.champions
    ).toHaveLength(5)
    raw.data[0].positions = raw.data[0].positions.filter((p) => p.name !== 'MID')
    expect(
      adaptLolpsChampionOverview(raw, { mode: 'ranked', position: 'middle' }).sections.champions
    ).toEqual([])
  })

  it('rejects unsupported regions, ranks and unmapped historical patches instead of silently fetching defaults', async () => {
    const { api, requests } = setup()
    await api.getVersions()
    for (const query of [{ region: 'euw' }, { tier: 'challenger' }, { version: '26.99' }]) {
      await expect(api.getChampion(103, query)).rejects.toThrow()
    }
    expect(requests.every((r) => r.url === 'https://lol.ps/statistics')).toBe(true)
  })

  it('withholds a mismatched section instead of relabeling another region or patch', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { api } = setup((config) => {
        const result = payload(config) as any
        if (config.url?.includes('skill')) result.data.regionId = 0
        return result
      })
      const result = await api.getChampion(103, { region: 'na', version: '26.18' })
      expect(result.data.skill_masteries).toEqual([])
      expect(result.data.summoner_spells).toHaveLength(1)
    } finally {
      vi.restoreAllMocks()
    }
  })
})
