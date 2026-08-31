import type { AxiosInstance } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { OpggHttpApiAxiosHelper } from './index'

describe('OpggHttpApiAxiosHelper', () => {
  it('passes the complete matchup dimensions to the champion endpoint', async () => {
    const get = vi.fn().mockResolvedValue({ data: { data: {} } })
    const httpClient = {
      defaults: {},
      get
    } as unknown as AxiosInstance
    const signal = new AbortController().signal

    const helper = new OpggHttpApiAxiosHelper(httpClient)

    await helper.getChampion('kr', 'ranked', 41, 'top', {
      tier: 'emerald_plus',
      version: '16.17',
      targetChampion: 887,
      signal
    })

    expect(get).toHaveBeenCalledWith('/api/kr/champions/ranked/41/top', {
      params: {
        tier: 'emerald_plus',
        version: '16.17',
        target_champion: 887
      },
      signal
    })
  })

  it('requests ARAM Mayhem tiers with the OP.GG content type', async () => {
    const get = vi.fn().mockResolvedValue({ data: { data: [] } })
    const httpClient = {
      defaults: {},
      get
    } as unknown as AxiosInstance
    const signal = new AbortController().signal

    const helper = new OpggHttpApiAxiosHelper(httpClient)

    await helper.getAramMayhemTiers({ signal })

    expect(get).toHaveBeenCalledWith('/api/contents/tiers', {
      params: {
        type: 'aram_mayhem'
      },
      signal
    })
  })
})
