import { RadixEventEmitter } from '@shared/utils/event-emitter'
import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import axiosRetry from 'axios-retry'
import { describe, expect, it, vi } from 'vitest'

import { FriendRequestTestClientExecutor } from './client-executor'

const target = { gameName: '测试小号', tagLine: 'TEST', puuid: 'target/puuid' }
function harness(respond: (config: AxiosRequestConfig) => unknown) {
  const events = new RadixEventEmitter()
  const requests: AxiosRequestConfig[] = []
  const http = axios.create({
    adapter: async (config) => {
      requests.push(config)
      return { data: respond(config), status: 200, statusText: 'OK', headers: {}, config }
    }
  })
  axiosRetry(http, { retries: 2, retryDelay: () => 0 })
  const executor = new FriendRequestTestClientExecutor({
    events,
    request: (config: AxiosRequestConfig) => http.request(config)
  } as never)
  return { executor, requests, events, signal: new AbortController().signal }
}

describe('friend test LCU protocol', () => {
  it('observes new chat errors without consuming the client queue or exposing arbitrary error text', () => {
    const h = harness(() => null)
    const listener = vi.fn()
    const dispose = h.executor.watchChatErrors(listener)
    const uri = '/lol-chat/v1/errors/e_test'
    h.events.emit(uri, { eventType: 'Delete', data: { code: 500, message: 'wait' } })
    h.events.emit(uri, { eventType: 'Create', data: { code: 'invalid', message: 'wait' } })
    expect(listener).not.toHaveBeenCalled()
    h.events.emit(uri, {
      eventType: 'Create',
      data: { code: 500, message: 'wait', text: 'private' }
    })
    h.events.emit(uri, {
      eventType: 'Create',
      data: { code: 400, message: 'arbitrary private text' }
    })
    expect(listener.mock.calls).toEqual([
      [{ code: 500, category: 'wait' }],
      [{ code: 400, category: 'unknown' }]
    ])
    dispose()
    h.events.emit(uri, { eventType: 'Create', data: { code: 500, message: 'wait' } })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(h.requests).toHaveLength(0)
  })
  it('resolves the exact name and tag instead of trusting the first returned alias', async () => {
    const { executor, requests, signal } = harness(() => [
      { ...target, puuid: 'other', tagLine: 'OTHER' },
      target
    ])
    expect(await executor.resolve(' 测试小号 ', 'test', signal)).toEqual(target)
    expect(requests[0].url).toBe('/lol-summoner/v1/summoners/aliases')
    expect(JSON.parse(requests[0].data)).toEqual([{ gameName: ' 测试小号 ', tagLine: 'test' }])
  })

  it('refuses an ambiguous alias response and treats no exact match as missing', async () => {
    const duplicate = harness(() => [target, target])
    await expect(
      duplicate.executor.resolve(target.gameName, target.tagLine, duplicate.signal)
    ).rejects.toThrow('invalid-response')
    const missing = harness(() => [{ ...target, tagLine: 'OTHER' }])
    expect(
      await missing.executor.resolve(target.gameName, target.tagLine, missing.signal)
    ).toBeNull()
  })

  it('selects by PUUID and uses different identifiers for withdrawing a request and deleting a friendship', async () => {
    const h = harness((config) => {
      if (config.url === '/lol-chat/v1/friends')
        return [{ id: 'unrelated', puuid: 'another-puuid' }]
      if (config.method === 'get')
        return [{ puuid: target.puuid, direction: 'out', id: 'not-the-path-id' }]
      return null
    })
    expect(await h.executor.relationship(target.puuid, h.signal)).toEqual({
      friend: null,
      request: { puuid: target.puuid, direction: 'out' }
    })
    await h.executor.send(target, h.signal)
    await h.executor.withdraw(target.puuid, h.signal)
    await h.executor.remove('chat/friend-id', h.signal)
    expect(
      h.requests
        .filter((config) => config.method !== 'get')
        .map((config) => [config.method, config.url])
    ).toEqual([
      ['post', '/lol-chat/v2/friend-requests'],
      ['delete', '/lol-chat/v2/friend-requests/target%2Fpuuid'],
      ['delete', '/lol-chat/v1/friends/chat%2Ffriend-id']
    ])
    expect(JSON.parse(h.requests[2].data)).toEqual({ ...target, gameTag: target.tagLine })
  })

  it('refuses incomplete relationship data instead of interpreting it as empty', async () => {
    const h = harness((config) =>
      config.url === '/lol-chat/v1/friends' ? [] : [{ puuid: target.puuid }]
    )
    await expect(h.executor.relationship(target.puuid, h.signal)).rejects.toThrow(
      'invalid-response'
    )
  })

  it.each([429, 500])(
    'disables the underlying automatic DELETE retries for HTTP %s',
    async (status) => {
      const respond = vi.fn((config: AxiosRequestConfig) => {
        throw new AxiosError('simulated response', undefined, config as never, undefined, {
          status,
          statusText: 'test',
          data: {},
          headers: {},
          config: config as never
        })
      })
      const h = harness(respond)
      await expect(h.executor.withdraw(target.puuid, h.signal)).rejects.toMatchObject({
        response: { status }
      })
      expect(respond).toHaveBeenCalledTimes(1)
    }
  )

  it('does not dispatch a write after cancellation', async () => {
    const h = harness(() => null)
    const abort = new AbortController()
    abort.abort()
    await expect(h.executor.remove('friend-id', abort.signal)).rejects.toThrow()
    expect(h.requests).toHaveLength(0)
  })
})
