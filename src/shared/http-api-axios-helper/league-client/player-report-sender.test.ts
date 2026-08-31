import axios, { type AxiosAdapter, type GenericAbortSignal } from 'axios'
import { describe, expect, it } from 'vitest'

import { PlayerReportSenderHttpApi } from './player-report-sender'

describe('PlayerReportSenderHttpApi', () => {
  it('uses the current plural reported-players endpoint and forwards cancellation', async () => {
    let capturedUrl: string | undefined
    let capturedSignal: GenericAbortSignal | undefined
    const adapter: AxiosAdapter = async (config) => {
      capturedUrl = config.url
      capturedSignal = config.signal
      return {
        config,
        data: ['player-puuid'],
        headers: {},
        status: 200,
        statusText: 'OK'
      }
    }
    const api = new PlayerReportSenderHttpApi(axios.create({ adapter }))
    const controller = new AbortController()

    const response = await api.getReportedPlayersByGameId(123, { signal: controller.signal })

    expect(capturedUrl).toBe('/lol-player-report-sender/v1/reported-players/gameId/123')
    expect(capturedSignal).toBe(controller.signal)
    expect(response.data).toEqual(['player-puuid'])
  })
})
