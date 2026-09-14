import type {
  FriendRequestTestChatError,
  FriendRequestTestOptions
} from '@shared/shards/friend-request-test'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  FriendRequestTestApi,
  FriendRequestTestSession,
  FriendTestRelationship
} from './context'
import { FriendRequestTestState } from './state'
import { FriendRequestTestController } from './test-controller'

const target = { puuid: 'target-puuid', gameName: '测试小号', tagLine: 'TEST' }
const options: FriendRequestTestOptions = {
  riotId: '测试小号#TEST',
  durationMinutes: 1,
  intervalSeconds: 30,
  removeAccepted: false,
  consented: true
}
const empty = (): FriendTestRelationship => ({ friend: null, request: null })
const pending = (): FriendTestRelationship => ({
  friend: null,
  request: { puuid: target.puuid, direction: 'out' }
})
const accepted = (): FriendTestRelationship => ({
  friend: { id: 'chat-friend-id', puuid: target.puuid },
  request: null
})
const httpError = (status: number) =>
  Object.assign(new AxiosError('test response'), { response: { status } })

function harness(initial = empty()) {
  let relationship = initial
  let session: FriendRequestTestSession | null = { connection: {}, selfPuuid: 'self-puuid' }
  let chatListener: ((error: FriendRequestTestChatError) => void) | null = null
  const stopWatching = vi.fn(() => {
    chatListener = null
  })
  const api = {
    watchChatErrors: vi.fn<FriendRequestTestApi['watchChatErrors']>((listener) => {
      chatListener = listener
      return stopWatching
    }),
    resolve: vi.fn<FriendRequestTestApi['resolve']>(async () => target),
    relationship: vi.fn<FriendRequestTestApi['relationship']>(async () =>
      structuredClone(relationship)
    ),
    send: vi.fn<FriendRequestTestApi['send']>(async () => {
      relationship = pending()
    }),
    withdraw: vi.fn<FriendRequestTestApi['withdraw']>(async () => {
      relationship = empty()
    }),
    remove: vi.fn<FriendRequestTestApi['remove']>(async () => {
      relationship = empty()
    })
  }
  const state = new FriendRequestTestState()
  const controller = new FriendRequestTestController({
    state,
    api,
    getSession: () => session,
    logger: { info: vi.fn(), warn: vi.fn() }
  })
  return {
    api,
    state,
    controller,
    chatError: (error: FriendRequestTestChatError) => chatListener?.(error),
    stopWatching,
    setRelationship: (value: FriendTestRelationship) => {
      relationship = value
    },
    setSession: (value: FriendRequestTestSession | null) => {
      session = value
    }
  }
}

beforeEach(() =>
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance']
  })
)
afterEach(() => vi.useRealTimers())

describe('timed friend request lifecycle', () => {
  it('uses the configured interval and finishes by withdrawing the last request at the duration limit', async () => {
    const { controller, api, state } = harness()
    expect(controller.start({ ...options, durationMinutes: 2, intervalSeconds: 45 })).toEqual({
      started: true
    })
    await vi.advanceTimersByTimeAsync(44_000)
    expect(api.send).toHaveBeenCalledTimes(1)
    expect(api.withdraw).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(77_000)
    expect(state.snapshot).toMatchObject({
      active: false,
      phase: 'completed',
      reason: 'finished',
      remainingMs: 0,
      sent: 3,
      withdrawn: 3,
      removed: 0,
      mayHaveRelationship: false
    })
    expect(api.withdraw).toHaveBeenCalledWith(target.puuid, expect.any(AbortSignal))
    expect(api.remove).not.toHaveBeenCalled()
  })

  it('freezes both clocks while paused, then resumes the same request without an extra send', async () => {
    const { controller, api, state } = harness()
    controller.start(options)
    await vi.advanceTimersByTimeAsync(10_000)
    controller.pause()
    const remaining = state.snapshot.remainingMs
    const waiting = state.snapshot.waitRemainingMs
    await vi.advanceTimersByTimeAsync(120_000)
    expect(state.snapshot).toMatchObject({
      active: true,
      paused: true,
      remainingMs: remaining,
      waitRemainingMs: waiting
    })
    expect(api.send).toHaveBeenCalledTimes(1)
    expect(api.withdraw).not.toHaveBeenCalled()
    controller.resume()
    await vi.advanceTimersByTimeAsync(51_000)
    expect(state.snapshot).toMatchObject({
      active: false,
      sent: 2,
      withdrawn: 2,
      reason: 'finished'
    })
  })

  it('allows an in-flight send to settle while paused but performs no subsequent action until resumed', async () => {
    const h = harness()
    h.api.send.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      h.setRelationship(pending())
    })
    h.controller.start(options)
    await vi.advanceTimersByTimeAsync(0)
    h.controller.pause()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.state.snapshot).toMatchObject({ paused: true, sent: 0, remainingMs: 60_000 })
    expect(h.api.withdraw).not.toHaveBeenCalled()
    h.controller.resume()
    await vi.advanceTimersByTimeAsync(61_000)
    expect(h.state.snapshot).toMatchObject({ active: false, withdrawn: 2, reason: 'finished' })
  })

  it.each([false, true])(
    'handles acceptance after a pause with removeAccepted=%s',
    async (removeAccepted) => {
      const h = harness()
      h.controller.start({ ...options, removeAccepted })
      await vi.advanceTimersByTimeAsync(10_000)
      h.controller.pause()
      h.setRelationship(accepted())
      await vi.advanceTimersByTimeAsync(40_000)
      expect(h.api.remove).not.toHaveBeenCalled()
      h.controller.resume()
      await vi.advanceTimersByTimeAsync(51_000)
      if (removeAccepted) {
        expect(h.api.remove).toHaveBeenCalledExactlyOnceWith(
          'chat-friend-id',
          expect.any(AbortSignal)
        )
        expect(h.state.snapshot).toMatchObject({
          sent: 2,
          removed: 1,
          withdrawn: 1,
          reason: 'finished'
        })
      } else {
        expect(h.api.remove).not.toHaveBeenCalled()
        expect(h.state.snapshot).toMatchObject({
          active: false,
          sent: 1,
          removed: 0,
          reason: 'accepted-kept',
          mayHaveRelationship: true
        })
      }
    }
  )

  it('reconciles an acceptance racing with a withdrawal without repeating either write', async () => {
    const h = harness()
    h.api.withdraw.mockImplementationOnce(async () => {
      h.setRelationship(accepted())
      throw httpError(404)
    })
    h.controller.start({ ...options, intervalSeconds: 60, removeAccepted: true })
    await vi.advanceTimersByTimeAsync(61_000)
    expect(h.api.withdraw).toHaveBeenCalledTimes(1)
    expect(h.api.remove).toHaveBeenCalledExactlyOnceWith('chat-friend-id', expect.any(AbortSignal))
    expect(h.state.snapshot).toMatchObject({
      sent: 1,
      withdrawn: 0,
      removed: 1,
      reason: 'finished'
    })
  })

  it('waits for a transient overlap of the friend and request lists to settle before deleting', async () => {
    const h = harness()
    h.controller.start({ ...options, removeAccepted: true })
    await vi.advanceTimersByTimeAsync(29_000)
    h.setRelationship({ ...accepted(), request: pending().request })
    await vi.advanceTimersByTimeAsync(1500)
    expect(h.api.remove).not.toHaveBeenCalled()
    h.setRelationship(accepted())
    await vi.advanceTimersByTimeAsync(30_500)
    expect(h.state.snapshot).toMatchObject({
      active: false,
      removed: 1,
      withdrawn: 1,
      reason: 'finished'
    })
  })

  it.each([
    accepted(),
    pending(),
    { friend: null, request: { puuid: target.puuid, direction: 'in' as const } }
  ])('preserves an existing relationship %#', async (relationship) => {
    const h = harness(relationship)
    h.controller.start({ ...options, removeAccepted: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.state.snapshot.active).toBe(false)
    expect(h.api.send).not.toHaveBeenCalled()
    expect(h.api.withdraw).not.toHaveBeenCalled()
    expect(h.api.remove).not.toHaveBeenCalled()
  })

  it('ends when a request disappears instead of sending another after a rejection', async () => {
    const h = harness()
    h.controller.start(options)
    await vi.advanceTimersByTimeAsync(10_000)
    h.setRelationship(empty())
    await vi.advanceTimersByTimeAsync(55_000)
    expect(h.api.send).toHaveBeenCalledTimes(1)
    expect(h.api.withdraw).not.toHaveBeenCalled()
    expect(h.state.snapshot).toMatchObject({
      active: false,
      reason: 'request-disappeared',
      mayHaveRelationship: false
    })
  })

  it('does not count an unconfirmed removal or proceed to another send', async () => {
    const h = harness()
    h.api.withdraw.mockResolvedValue(undefined)
    h.controller.start(options)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(h.api.withdraw).toHaveBeenCalledTimes(1)
    expect(h.api.send).toHaveBeenCalledTimes(1)
    expect(h.state.snapshot).toMatchObject({
      active: false,
      reason: 'removal-not-confirmed',
      withdrawn: 0,
      mayHaveRelationship: true
    })
  })

  it.each([null, { connection: {}, selfPuuid: 'different-account' }])(
    'stops on connection or account changes even while paused %#',
    async (session) => {
      const h = harness()
      h.controller.start(options)
      await vi.advanceTimersByTimeAsync(10_000)
      h.controller.pause()
      h.setSession(session)
      await vi.advanceTimersByTimeAsync(1000)
      expect(h.state.snapshot).toMatchObject({ active: false, reason: 'session-changed' })
      expect(h.api.send).toHaveBeenCalledTimes(1)
      expect(h.api.withdraw).not.toHaveBeenCalled()
    }
  )

  it('cancels a pending request on stop and never follows it with another mutation', async () => {
    const h = harness()
    h.api.send.mockImplementation(
      (_target, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    h.controller.start(options)
    await vi.advanceTimersByTimeAsync(1000)
    h.controller.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.state.snapshot).toMatchObject({
      active: false,
      phase: 'stopped',
      reason: 'user-stopped',
      mayHaveRelationship: true
    })
    expect(h.api.send).toHaveBeenCalledTimes(1)
    expect(h.api.withdraw).not.toHaveBeenCalled()
    expect(h.api.remove).not.toHaveBeenCalled()
  })

  it('ends on rate limiting instead of retrying', async () => {
    const h = harness()
    h.api.send.mockRejectedValue(httpError(429))
    h.controller.start(options)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(h.api.send).toHaveBeenCalledTimes(1)
    expect(h.state.snapshot).toMatchObject({
      active: false,
      phase: 'failed',
      reason: 'rate-limited',
      httpStatus: 429,
      lastOperation: 'send'
    })
  })

  it('rejects invalid settings and concurrent starts', async () => {
    const h = harness()
    for (const invalid of [
      { consented: false },
      { intervalSeconds: -1 },
      { intervalSeconds: NaN },
      { durationMinutes: 0 },
      { durationMinutes: 1.5 },
      { riotId: 'only-name' }
    ]) {
      expect(h.controller.start({ ...options, ...invalid })).toEqual({
        started: false,
        reason: 'invalid-options'
      })
    }
    expect(h.api.resolve).not.toHaveBeenCalled()
    h.controller.start(options)
    expect(h.controller.start(options)).toEqual({ started: false, reason: 'busy' })
    await vi.advanceTimersByTimeAsync(1000)
    h.controller.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state.snapshot.active).toBe(false)
  })

  it.each([0, 0.05, 0.5, 1])(
    'preserves a %s-second interval, includes confirmation time, then stops at the first 429',
    async (intervalSeconds) => {
      const h = harness()
      let calls = 0
      h.api.send.mockImplementation(async () => {
        // Simulate real network latency so zero does not form a synchronous fake-timer loop.
        await new Promise((resolve) => setTimeout(resolve, 20))
        if (++calls === 3) throw httpError(429)
        h.setRelationship(pending())
      })
      h.controller.start({ ...options, intervalSeconds })
      await vi.advanceTimersByTimeAsync(5000)
      expect(h.api.send).toHaveBeenCalledTimes(3)
      expect(h.state.snapshot).toMatchObject({
        active: false,
        sent: 2,
        withdrawn: 2,
        httpStatus: 429,
        lastOperation: 'send'
      })
      expect(h.state.snapshot.lastSendIntervalMs).toBeCloseTo(
        Math.max(20, intervalSeconds * 1000) + 500,
        0
      )
      expect(h.state.snapshot.options?.intervalSeconds).toBe(intervalSeconds)
      expect(h.state.snapshot.remainingMs).toBeGreaterThan(55_000)
    }
  )

  it('confirms a delayed server withdrawal after the old five-second timeout without resending', async () => {
    const h = harness()
    h.api.withdraw.mockImplementationOnce(async () => {
      setTimeout(() => h.setRelationship(empty()), 8000)
    })
    h.controller.start({ ...options, intervalSeconds: 60 })
    await vi.advanceTimersByTimeAsync(66_000)
    expect(h.state.snapshot).toMatchObject({ active: true, withdrawn: 0, sent: 1 })
    await vi.advanceTimersByTimeAsync(4000)
    expect(h.state.snapshot).toMatchObject({ active: false, withdrawn: 1, reason: 'finished' })
    expect(h.api.withdraw).toHaveBeenCalledTimes(1)
    expect(h.api.send).toHaveBeenCalledTimes(1)
  })

  it('does not count a transient empty list as a completed withdrawal', async () => {
    const h = harness(pending())
    h.api.withdraw.mockImplementationOnce(async () => {
      h.setRelationship(empty())
      setTimeout(() => h.setRelationship(pending()), 100)
      setTimeout(() => h.setRelationship(empty()), 7000)
    })
    h.controller.start(options, 'withdraw-only')
    await vi.advanceTimersByTimeAsync(6000)
    expect(h.state.snapshot).toMatchObject({ active: true, withdrawn: 0 })
    await vi.advanceTimersByTimeAsync(4000)
    expect(h.state.snapshot).toMatchObject({ reason: 'withdrawn-only', withdrawn: 1, sent: 0 })
    expect(h.api.withdraw).toHaveBeenCalledTimes(1)
    expect(h.api.send).not.toHaveBeenCalled()
  })

  it('discards an empty observation from before a pause', async () => {
    const h = harness(pending())
    h.controller.start(options, 'withdraw-only')
    await vi.advanceTimersByTimeAsync(100)
    h.controller.pause()
    h.setRelationship(pending())
    await vi.advanceTimersByTimeAsync(60_000)
    h.controller.resume()
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.state.snapshot).toMatchObject({ active: true, withdrawn: 0 })
    h.setRelationship(empty())
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.state.snapshot).toMatchObject({ active: false, withdrawn: 1 })
    expect(h.api.withdraw).toHaveBeenCalledTimes(1)
  })

  it('keeps an asynchronous chat error separate from HTTP status and permits a later single cleanup', async () => {
    const h = harness(pending())
    h.chatError({ code: 400, category: 'cancel' })
    h.api.withdraw.mockImplementationOnce(async () => {
      setTimeout(() => h.chatError({ code: 500, category: 'wait' }), 100)
    })
    h.controller.start(options, 'withdraw-only')
    await vi.advanceTimersByTimeAsync(16_000)
    expect(h.state.snapshot).toMatchObject({
      active: false,
      reason: 'removal-not-confirmed',
      lastOperation: 'withdraw',
      httpStatus: null,
      chatError: { code: 500, category: 'wait' },
      sent: 0,
      withdrawn: 0,
      mayHaveRelationship: true
    })
    expect(h.stopWatching).toHaveBeenCalledTimes(1)
    expect(h.api.withdraw).toHaveBeenCalledTimes(1)
    h.controller.start(options, 'withdraw-only')
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.state.snapshot).toMatchObject({
      reason: 'withdrawn-only',
      withdrawn: 1,
      chatError: null,
      mayHaveRelationship: false
    })
    expect(h.api.withdraw).toHaveBeenCalledTimes(2)
    expect(h.api.send).not.toHaveBeenCalled()
  })

  it('does not call a send confirmed when only the HTTP acknowledgement succeeded', async () => {
    const h = harness()
    h.api.send.mockResolvedValue(undefined)
    h.controller.start(options)
    await vi.advanceTimersByTimeAsync(16_000)
    expect(h.state.snapshot).toMatchObject({
      active: false,
      sent: 0,
      reason: 'request-not-confirmed',
      lastOperation: 'send'
    })
    expect(h.api.send).toHaveBeenCalledTimes(1)
    expect(h.api.withdraw).not.toHaveBeenCalled()
  })

  it.each([
    empty(),
    accepted(),
    { friend: null, request: { puuid: target.puuid, direction: 'in' as const } }
  ])(
    'single withdrawal never deletes a friendship, incoming request, or missing request %#',
    async (relationship) => {
      const h = harness(relationship)
      h.controller.start({ ...options, removeAccepted: true }, 'withdraw-only')
      await vi.advanceTimersByTimeAsync(1000)
      expect(h.state.snapshot.active).toBe(false)
      expect(h.api.send).not.toHaveBeenCalled()
      expect(h.api.withdraw).not.toHaveBeenCalled()
      expect(h.api.remove).not.toHaveBeenCalled()
    }
  )

  it('keeps a friendship accepted during single withdrawal even if the loop removal option is enabled', async () => {
    const h = harness(pending())
    h.api.withdraw.mockImplementationOnce(async () => h.setRelationship(accepted()))
    h.controller.start({ ...options, removeAccepted: true }, 'withdraw-only')
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.state.snapshot).toMatchObject({ reason: 'accepted-kept', withdrawn: 0, removed: 0 })
    expect(h.api.send).not.toHaveBeenCalled()
    expect(h.api.remove).not.toHaveBeenCalled()
  })
})
