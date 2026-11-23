import {
  AI_COACH_ANTHROPIC_BASE_URL,
  type AiCoachChatRequest,
  type AiCoachChatResult,
  type AiCoachProvider
} from '@shared/shards/ai-coach'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AiCoachChatController } from './chat-controller'
import {
  AI_COACH_CONNECT_TIMEOUT_MS,
  AI_COACH_DELTA_FLUSH_MS,
  AI_COACH_REQUEST_TIMEOUT_MS,
  type AiCoachExecuteInput,
  type AiCoachExecutor,
  type AiCoachFetch
} from './context'
import { AiCoachSettings } from './state'

const KEY = 'sk-test-0123456789abcdef'
const DOCUMENT = '这是对局资料：中路，十五分钟补刀一百二。'

const request = (values: Partial<AiCoachChatRequest> = {}): AiCoachChatRequest => ({
  requestId: 'review-1',
  system: '你是教练。',
  messages: [{ role: 'user', content: DOCUMENT }],
  ...values
})

const ok = (text = '回答'): AiCoachChatResult => ({
  result: 'ok',
  text,
  truncated: false,
  usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
  model: 'model'
})

/** An executor the test finishes by hand, like a provider that is still answering. */
function createPendingExecutor() {
  const calls: AiCoachExecuteInput[] = []
  const finishers: Array<(result: AiCoachChatResult) => void> = []
  const executor: AiCoachExecutor = (input) => {
    calls.push(input)
    return new Promise((resolve) => {
      finishers.push(resolve)
      // Like the real ones: an aborted request ends as cancelled.
      input.signal.addEventListener('abort', () => {
        finishers.splice(finishers.indexOf(resolve), 1)
        resolve({ result: 'failed', code: 'cancelled', message: '', text: '' })
      })
    })
  }
  return { executor, calls, finish: (result = ok()) => finishers.shift()?.(result) }
}

function createHarness(
  options: {
    executors?: Partial<Record<AiCoachProvider, AiCoachExecutor>>
    keys?: Partial<Record<AiCoachProvider, string>>
    fetch?: AiCoachFetch
  } = {}
) {
  const settings = new AiCoachSettings()
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const keys = options.keys ?? { anthropic: KEY, 'openai-compatible': KEY }
  const anthropic = vi.fn<AiCoachExecutor>(async () => ok('claude'))
  const openai = vi.fn<AiCoachExecutor>(async () => ok('other'))
  const fetch = vi.fn<AiCoachFetch>(options.fetch ?? (async () => new Response('')))
  const controller = new AiCoachChatController(
    { settings, logger: logger as never },
    { get: (provider) => keys[provider] ?? null },
    { anthropic, 'openai-compatible': openai, ...options.executors },
    fetch
  )
  const logged = () =>
    JSON.stringify(
      [logger.info, logger.warn, logger.error, logger.debug].map((log) => log.mock.calls)
    )
  return { controller, settings, logger, logged, anthropic, openai, fetch }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AiCoachChatController', () => {
  describe('before anything is sent', () => {
    it('refuses a request that is not a conversation', async () => {
      const { controller, anthropic } = createHarness()

      await expect(controller.chat(request({ messages: [] }), () => {})).resolves.toMatchObject({
        result: 'failed',
        code: 'invalid-request'
      })
      await expect(controller.chat(null as never, () => {})).resolves.toMatchObject({
        result: 'failed',
        code: 'invalid-request'
      })
      expect(anthropic).not.toHaveBeenCalled()
    })

    it.each([
      ['no model for Claude', { anthropicModel: '  ' }],
      ['an unusable relay address', { anthropicBaseUrl: 'http://relay.example.com' }],
      ['no address for the other kind of service', { provider: 'openai-compatible' as const }],
      [
        'no model for the other kind of service',
        { provider: 'openai-compatible' as const, openaiBaseUrl: 'https://api.example.com/v1' }
      ]
    ])('says it is not set up with %s', async (_, values) => {
      const { controller, settings, anthropic, openai } = createHarness()
      Object.assign(settings, values)

      await expect(controller.chat(request(), () => {})).resolves.toMatchObject({
        result: 'failed',
        code: 'not-configured'
      })
      expect(anthropic).not.toHaveBeenCalled()
      expect(openai).not.toHaveBeenCalled()
    })

    it('asks for a key when the chosen provider has none', async () => {
      const { controller, settings, anthropic, openai } = createHarness({
        keys: { anthropic: KEY }
      })
      Object.assign(settings, {
        provider: 'openai-compatible',
        openaiBaseUrl: 'https://api.example.com/v1',
        openaiModel: 'some-model'
      })

      await expect(controller.chat(request(), () => {})).resolves.toMatchObject({
        result: 'failed',
        code: 'no-key'
      })
      expect(anthropic).not.toHaveBeenCalled()
      expect(openai).not.toHaveBeenCalled()
    })
  })

  describe('choosing where the request goes', () => {
    it('uses the official Claude address unless a relay is filled in', async () => {
      const { controller, settings, anthropic } = createHarness()

      await controller.chat(request(), () => {})
      expect(anthropic).toHaveBeenLastCalledWith(
        expect.objectContaining({
          apiKey: KEY,
          model: 'claude-opus-5-5',
          baseUrl: AI_COACH_ANTHROPIC_BASE_URL,
          system: '你是教练。',
          messages: [{ role: 'user', content: DOCUMENT }]
        })
      )

      Object.assign(settings, {
        anthropicModel: ' claude-sonnet-5-5 ',
        anthropicBaseUrl: ' https://relay.example.com/claude/ '
      })
      await controller.chat(request(), () => {})
      expect(anthropic).toHaveBeenLastCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-5-5',
          baseUrl: 'https://relay.example.com/claude'
        })
      )
    })

    it('uses the other service with its own address, model and key', async () => {
      const { controller, settings, anthropic, openai } = createHarness({
        keys: { anthropic: KEY, 'openai-compatible': 'sk-other-0123456789' }
      })
      Object.assign(settings, {
        provider: 'openai-compatible',
        openaiBaseUrl: 'https://api.deepseek.com/',
        openaiModel: 'deepseek-chat'
      })

      await expect(controller.chat(request(), () => {})).resolves.toMatchObject({ text: 'other' })
      expect(anthropic).not.toHaveBeenCalled()
      expect(openai).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-other-0123456789',
          model: 'deepseek-chat',
          baseUrl: 'https://api.deepseek.com'
        })
      )
    })
  })

  describe('while an answer is being written', () => {
    it('hands the pieces over in batches and never loses the last one', async () => {
      const pending = createPendingExecutor()
      const { controller } = createHarness({ executors: { anthropic: pending.executor } })
      const deltas: string[] = []
      const result = controller.chat(request(), (text) => deltas.push(text))

      const [input] = pending.calls
      input.onDelta('先')
      input.onDelta('说')
      input.onDelta('结论')
      expect(deltas).toEqual([])

      await vi.advanceTimersByTimeAsync(AI_COACH_DELTA_FLUSH_MS)
      expect(deltas).toEqual(['先说结论'])

      input.onDelta('：补刀')
      await vi.advanceTimersByTimeAsync(AI_COACH_DELTA_FLUSH_MS)
      input.onDelta('落后。')
      pending.finish(ok('先说结论：补刀落后。'))

      await expect(result).resolves.toMatchObject({ result: 'ok', text: '先说结论：补刀落后。' })
      expect(deltas).toEqual(['先说结论', '：补刀', '落后。'])
      expect(deltas.join('')).toBe('先说结论：补刀落后。')
    })

    it('answers one conversation at a time', async () => {
      const pending = createPendingExecutor()
      const { controller } = createHarness({ executors: { anthropic: pending.executor } })
      const first = controller.chat(request({ requestId: 'first' }), () => {})

      await expect(
        controller.chat(request({ requestId: 'second' }), () => {})
      ).resolves.toMatchObject({ result: 'failed', code: 'busy' })
      expect(pending.calls).toHaveLength(1)

      pending.finish()
      await first
      const third = controller.chat(request({ requestId: 'third' }), () => {})
      expect(pending.calls).toHaveLength(2)
      pending.finish()
      await expect(third).resolves.toMatchObject({ result: 'ok' })
    })

    it('stops the answer it is asked to stop, and no other', async () => {
      const pending = createPendingExecutor()
      const { controller } = createHarness({ executors: { anthropic: pending.executor } })
      const result = controller.chat(request({ requestId: 'first' }), () => {})

      expect(controller.cancel('another')).toBe(false)
      expect(pending.calls[0].signal.aborted).toBe(false)
      expect(controller.cancel('first')).toBe(true)

      await expect(result).resolves.toMatchObject({ result: 'failed', code: 'cancelled' })
      expect(controller.cancel('first')).toBe(false)
    })

    it('stops whatever is running when no id is given', async () => {
      const pending = createPendingExecutor()
      const { controller } = createHarness({ executors: { anthropic: pending.executor } })
      expect(controller.cancel()).toBe(false)

      const result = controller.chat(request(), () => {})
      expect(controller.cancel()).toBe(true)

      await expect(result).resolves.toMatchObject({ result: 'failed', code: 'cancelled' })
    })

    it('stops the answer when the app shuts down', async () => {
      const pending = createPendingExecutor()
      const { controller } = createHarness({ executors: { anthropic: pending.executor } })
      const result = controller.chat(request(), () => {})

      controller.dispose()

      await expect(result).resolves.toMatchObject({ result: 'failed', code: 'cancelled' })
    })
  })

  describe('time limits', () => {
    it('gives up when the whole answer takes too long', async () => {
      const pending = createPendingExecutor()
      const { controller } = createHarness({ executors: { anthropic: pending.executor } })
      const result = controller.chat(request(), () => {})

      await vi.advanceTimersByTimeAsync(AI_COACH_REQUEST_TIMEOUT_MS - 1)
      expect(pending.calls[0].signal.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      await expect(result).resolves.toMatchObject({ result: 'failed', code: 'timeout' })
      // Free for the next request.
      const next = controller.chat(request(), () => {})
      pending.finish()
      await expect(next).resolves.toMatchObject({ result: 'ok' })
    })

    it('gives up when the service does not start answering', async () => {
      const { controller } = createHarness({
        executors: {
          anthropic: async (input) => {
            try {
              await input.fetch('https://api.example.com', { signal: input.signal })
              return ok()
            } catch {
              return { result: 'failed', code: 'cancelled', message: '', text: '' }
            }
          }
        },
        // A connection that hangs until it is aborted.
        fetch: (_, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          )
      })
      const result = controller.chat(request(), () => {})

      await vi.advanceTimersByTimeAsync(AI_COACH_CONNECT_TIMEOUT_MS)

      await expect(result).resolves.toMatchObject({ result: 'failed', code: 'timeout' })
    })

    it('lets a slow answer continue once the service has started answering', async () => {
      const pending = createPendingExecutor()
      const { controller, fetch } = createHarness({
        executors: {
          anthropic: async (input) => {
            await input.fetch('https://api.example.com')
            return pending.executor(input)
          }
        }
      })
      const result = controller.chat(request(), () => {})

      await vi.advanceTimersByTimeAsync(AI_COACH_CONNECT_TIMEOUT_MS * 2)
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(pending.calls[0].signal.aborted).toBe(false)

      pending.finish()
      await expect(result).resolves.toMatchObject({ result: 'ok' })
      // Nothing is left ticking that could stop a later request.
      expect(vi.getTimerCount()).toBe(0)
    })

    it('keeps a cancel a cancel even close to the limit', async () => {
      const pending = createPendingExecutor()
      const { controller } = createHarness({ executors: { anthropic: pending.executor } })
      const result = controller.chat(request(), () => {})

      await vi.advanceTimersByTimeAsync(AI_COACH_REQUEST_TIMEOUT_MS - 1)
      controller.cancel()

      await expect(result).resolves.toMatchObject({ result: 'failed', code: 'cancelled' })
    })
  })

  describe('when something goes wrong', () => {
    it('passes a failure of the provider on unchanged', async () => {
      const failure: AiCoachChatResult = {
        result: 'failed',
        code: 'auth',
        message: 'invalid key',
        text: ''
      }
      const { controller } = createHarness({ executors: { anthropic: async () => failure } })

      await expect(controller.chat(request(), () => {})).resolves.toEqual(failure)
    })

    it('turns an unexpected error into a failure and stays usable', async () => {
      const { controller, settings } = createHarness({
        executors: {
          anthropic: async () => {
            throw new Error(`boom ${KEY}`)
          }
        }
      })

      const result = await controller.chat(request(), () => {})

      expect(result).toEqual({ result: 'failed', code: 'unknown', message: '', text: '' })
      Object.assign(settings, {
        provider: 'openai-compatible',
        openaiBaseUrl: 'https://api.example.com/v1',
        openaiModel: 'some-model'
      })
      await expect(controller.chat(request(), () => {})).resolves.toMatchObject({ result: 'ok' })
    })
  })

  it('logs what happened without the key, the game document or the answer', async () => {
    const { controller, logged, logger } = createHarness({
      executors: {
        anthropic: async (input) => {
          input.onDelta('这段回答不该进日志')
          return ok('这段回答不该进日志')
        }
      }
    })
    await controller.chat(request(), () => {})
    await controller.chat(request({ messages: [] }), () => {})

    const failing = createHarness({
      executors: {
        anthropic: async () => ({
          result: 'failed',
          code: 'bad-request',
          message: `the service quoted the request: ${DOCUMENT}`,
          text: ''
        })
      }
    })
    await failing.controller.chat(request(), () => {})

    for (const text of [logged(), failing.logged()]) {
      expect(text).not.toContain(KEY)
      expect(text).not.toContain(DOCUMENT)
      expect(text).not.toContain('这段回答不该进日志')
    }
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('claude-opus-5-5'))
    expect(failing.logger.warn).toHaveBeenCalledWith(expect.stringContaining('bad-request'))
  })

  it('does not report a stop by the player as a problem', async () => {
    const pending = createPendingExecutor()
    const { controller, logger } = createHarness({ executors: { anthropic: pending.executor } })
    const result = controller.chat(request(), () => {})

    controller.cancel()
    await result

    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('stopped'))
  })
})
