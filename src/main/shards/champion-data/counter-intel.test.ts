import type { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import type { MatchupBuildParams } from '@shared/types/counter-intel'
import type { AxiosInstance } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { ChampionDataCounterIntel } from './counter-intel'

const PARAMS: MatchupBuildParams = {
  myChampionId: 41,
  opponentChampionId: 887,
  position: 'top',
  region: 'kr',
  tier: 'emerald_plus',
  version: '16.17'
}

function response(
  version: string,
  spellPlay = 98,
  starterPlay = 83,
  matchupPlay = 88,
  matchupWin = 42
) {
  return {
    data: {
      data: {
        summary: { id: 41, positions: [] },
        counters: [{ champion_id: 887, play: matchupPlay, win: matchupWin }],
        summoner_spells: [{ ids: [4, 14], play: spellPlay, win: 44, pick_rate: 0.8991 }],
        rune_pages: [],
        runes: [],
        skill_masteries: [],
        starter_items: [{ ids: [1055, 2003], play: starterPlay, win: 37, pick_rate: 0.783 }],
        boots: [],
        core_items: [],
        last_items: []
      },
      meta: { version, cached_at: '2026-08-31 06:16:31' }
    }
  }
}

function genericResponse(version: string) {
  return response(version, 12_000, 11_000)
}

function createSubject(
  getChampion: ReturnType<typeof vi.fn>,
  getChampions: ReturnType<typeof vi.fn> = vi.fn()
) {
  return new ChampionDataCounterIntel({
    logger: { info: vi.fn(), warn: vi.fn() } as any,
    opggApi: { getChampion, getChampions } as unknown as OpggHttpApiAxiosHelper,
    web: {} as AxiosInstance
  })
}

function counterResponse(version = '16.17') {
  return {
    data: {
      data: {
        // 基准英雄是 Gwen；win=Gwen 胜场，所以候选 Gangplank 胜场必须取 88 - 46。
        counters: [{ champion_id: 41, play: 88, win: 46 }]
      },
      meta: { version }
    }
  }
}

describe('ChampionDataCounterIntel.get', () => {
  it('binds the counter table to the requested version and complements the base wins', async () => {
    const getChampion = vi.fn().mockResolvedValue(counterResponse())
    const subject = createSubject(getChampion)

    const result = await subject.get(1, {
      championId: 887,
      position: 'top',
      region: 'kr',
      tier: 'emerald_plus',
      version: '16.17'
    })

    expect(getChampion).toHaveBeenCalledWith('kr', 'ranked', 887, 'top', {
      tier: 'emerald_plus',
      version: '16.17',
      signal: expect.any(AbortSignal)
    })
    expect(result.version).toBe('16.17')
    expect(result.rows).toEqual([
      expect.objectContaining({ championId: 41, games: 88, myWinRate: 42 / 88 })
    ])
  })

  it('keeps counter-table caches separate across patches and lets refresh bypass them', async () => {
    const getChampion = vi
      .fn()
      .mockImplementation((_region, _mode, _champion, _position, options) =>
        Promise.resolve(counterResponse(options.version))
      )
    const subject = createSubject(getChampion)
    const params = {
      championId: 887,
      position: 'top' as const,
      region: 'kr',
      tier: 'emerald_plus'
    }

    await subject.get(1, { ...params, version: '16.17' })
    await subject.get(1, { ...params, version: '16.17' })
    await subject.get(1, { ...params, version: '16.16' })
    await subject.get(1, { ...params, version: '16.17', force: true })

    expect(getChampion).toHaveBeenCalledTimes(3)
  })

  it('fails closed when OP.GG returns a different patch than requested', async () => {
    const subject = createSubject(vi.fn().mockResolvedValue(counterResponse('16.17')))

    await expect(
      subject.get(1, {
        championId: 887,
        position: 'top',
        region: 'kr',
        tier: 'emerald_plus',
        version: '16.16'
      })
    ).rejects.toThrow('克制表补丁不匹配')
  })
})

describe('ChampionDataCounterIntel.getRolePriors', () => {
  it('passes the patch to OP.GG and keys role-prior caches by patch', async () => {
    const getChampions = vi.fn().mockImplementation((_region, _mode, options) =>
      Promise.resolve({
        data: {
          data: [
            {
              id: 41,
              positions: [
                { name: 'TOP', stats: { play: 90 } },
                { name: 'MID', stats: { play: 10 } }
              ]
            }
          ],
          meta: { version: options.version }
        }
      })
    )
    const subject = createSubject(vi.fn(), getChampions)

    const first = await subject.getRolePriors('kr', 'emerald_plus', '16.17')
    await subject.getRolePriors('kr', 'emerald_plus', '16.17')
    await subject.getRolePriors('kr', 'emerald_plus', '16.16')

    expect(first[41]).toEqual({ top: 0.9, middle: 0.1 })
    expect(getChampions).toHaveBeenNthCalledWith(1, 'kr', 'ranked', {
      tier: 'emerald_plus',
      version: '16.17'
    })
    expect(getChampions).toHaveBeenNthCalledWith(2, 'kr', 'ranked', {
      tier: 'emerald_plus',
      version: '16.16'
    })
    expect(getChampions).toHaveBeenCalledTimes(2)
  })
})

describe('ChampionDataCounterIntel.getMatchupBuild', () => {
  it('uses the requested target and keeps the base champion win direction', async () => {
    const getChampion = vi
      .fn()
      .mockResolvedValueOnce(response('16.17'))
      .mockResolvedValueOnce(genericResponse('16.17'))
    const subject = createSubject(getChampion)

    const result = await subject.getMatchupBuild(PARAMS)

    expect(getChampion).toHaveBeenCalledWith('kr', 'ranked', 41, 'top', {
      tier: 'emerald_plus',
      version: '16.17',
      targetChampion: 887
    })
    expect(getChampion).toHaveBeenCalledWith('kr', 'ranked', 41, 'top', {
      tier: 'emerald_plus',
      version: '16.17'
    })
    expect(result.meta).toEqual({ play: 88, win: 42 })
    expect(result.targetVerified).toBe(true)
    expect(result.overlay?.summoner_spells).toEqual([
      { ids: [4, 14], play: 98, win: 44, pick_rate: 0.8991 }
    ])
  })

  it('keys the cache by version and lets a forced refresh bypass it', async () => {
    const getChampion = vi
      .fn()
      .mockImplementation((_region, _mode, _champion, _position, options) =>
        Promise.resolve(
          options.targetChampion ? response(options.version) : genericResponse(options.version)
        )
      )
    const subject = createSubject(getChampion)

    await subject.getMatchupBuild(PARAMS)
    await subject.getMatchupBuild(PARAMS)
    await subject.getMatchupBuild({ ...PARAMS, version: '16.16' })
    await subject.getMatchupBuild({ ...PARAMS, force: true })

    expect(getChampion).toHaveBeenCalledTimes(6)
  })

  it('fails closed and does not cache a generic large-sample response', async () => {
    const getChampion = vi
      .fn()
      .mockImplementation((_region, _mode, _champion, _position, options) =>
        Promise.resolve(
          options.targetChampion ? response('16.17', 12_000, 11_000) : genericResponse('16.17')
        )
      )
    const subject = createSubject(getChampion)

    const first = await subject.getMatchupBuild(PARAMS)
    const second = await subject.getMatchupBuild(PARAMS)

    expect(first).toMatchObject({ overlay: null, targetVerified: false })
    expect(second).toMatchObject({ overlay: null, targetVerified: false })
    expect(getChampion).toHaveBeenCalledTimes(4)
  })

  it('fails closed when OP.GG ignores target_champion and returns the generic build', async () => {
    // 截图级真实形态：meta 与通用构筑样本都约 1600，旧的 4x 阈值会误判为可信。
    const ignoredTarget = response('16.17', 1641, 1600, 1626, 782)
    const getChampion = vi.fn().mockResolvedValue(ignoredTarget)
    const subject = createSubject(getChampion)

    const first = await subject.getMatchupBuild(PARAMS)
    const second = await subject.getMatchupBuild(PARAMS)

    expect(first).toMatchObject({ overlay: null, targetVerified: false })
    expect(second).toMatchObject({ overlay: null, targetVerified: false })
    expect(getChampion).toHaveBeenCalledTimes(4)
  })

  it('fails closed when target and baseline counter anchors drift beyond the same-snapshot limit', async () => {
    const target = response('16.17')
    const baseline = genericResponse('16.17')
    baseline.data.data.counters[0] = { champion_id: 887, play: 100, win: 48 }
    const getChampion = vi.fn().mockResolvedValueOnce(target).mockResolvedValueOnce(baseline)
    const subject = createSubject(getChampion)

    const result = await subject.getMatchupBuild(PARAMS)

    expect(result).toMatchObject({ overlay: null, targetVerified: false })
  })

  it('rejects target and baseline responses from different patches even in latest mode', async () => {
    const getChampion = vi
      .fn()
      .mockResolvedValueOnce(response('16.17'))
      .mockResolvedValueOnce(genericResponse('16.16'))
    const subject = createSubject(getChampion)

    await expect(subject.getMatchupBuild({ ...PARAMS, version: null })).rejects.toThrow(
      '对位与基线补丁不一致'
    )
  })
})
