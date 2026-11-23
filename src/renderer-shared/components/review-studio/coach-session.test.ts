import {
  AI_COACH_MAX_MESSAGES,
  type AiCoachChatRequest,
  type AiCoachChatResult
} from '@shared/shards/ai-coach'
import { describe, expect, it, vi } from 'vitest'
import { isReactive } from 'vue'

import {
  REVIEW_COACH_MAX_SAVED_CONVERSATIONS,
  ReviewCoachSessionController,
  type ReviewCoachTarget,
  canAskReviewCoach,
  reviewCoachStorageKey
} from './coach-session'
import { REVIEW_STORAGE_NAMESPACE, type ReviewArchiveScope } from './notes'

const scope: ReviewArchiveScope = {
  ownerPuuid: 'owner',
  ownerServerId: 'NA1',
  targetPuuid: 'owner',
  targetServerId: 'NA1'
}
const target = (gameId = 100, values: Partial<ReviewCoachTarget> = {}): ReviewCoachTarget => ({
  scope,
  sgpServerId: 'NA1',
  gameId,
  ...values
})
const FIRST = '<对局资料>\n# 对局概况\n中单，胜利。\n</对局资料>\n\n请根据上面的资料复盘这一局。'
const input = { system: '你是教练。', firstMessage: FIRST }

const ok = (text: string, values: Partial<AiCoachChatResult & { result: 'ok' }> = {}) =>
  ({
    result: 'ok',
    text,
    truncated: false,
    usage: { inputTokens: 9000, outputTokens: 800, cachedInputTokens: 0 },
    model: 'claude-opus-5-5',
    ...values
  }) satisfies AiCoachChatResult
const failed = (
  code: (AiCoachChatResult & { result: 'failed' })['code'],
  text = '',
  message = ''
): AiCoachChatResult => ({ result: 'failed', code, message, text })

function createStorage(initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial))
  return {
    values,
    get: vi.fn(async (namespace: string, key: string, defaultValue?: unknown) =>
      values.has(`${namespace}:${key}`)
        ? structuredClone(values.get(`${namespace}:${key}`))
        : defaultValue
    ),
    set: vi.fn(async (namespace: string, key: string, value: unknown) => {
      // The real storage crosses a process boundary: only plain data survives.
      values.set(`${namespace}:${key}`, structuredClone(value))
    })
  }
}

/** A provider the test answers by hand. */
function createTransport() {
  const calls: Array<{
    request: AiCoachChatRequest
    onDelta: (text: string) => void
    finish: (result: AiCoachChatResult) => void
  }> = []
  const cancelled: string[] = []
  return {
    calls,
    cancelled,
    chat: vi.fn(
      (request: AiCoachChatRequest, onDelta: (text: string) => void) =>
        new Promise<AiCoachChatResult>((resolve) =>
          calls.push({ request, onDelta, finish: resolve })
        )
    ),
    cancel: vi.fn((requestId: string) => {
      cancelled.push(requestId)
      // Like the real provider: the pending request ends as cancelled with what it had written.
      const call = calls.find((item) => item.request.requestId === requestId)
      call?.finish(failed('cancelled', call.request.requestId === requestId ? written(call) : ''))
      return true
    })
  }
}
const texts = new WeakMap<object, string>()
const written = (call: object) => texts.get(call) ?? ''
function write(call: { onDelta: (text: string) => void }, text: string) {
  texts.set(call, written(call) + text)
  call.onDelta(text)
}

function createHarness(storage = createStorage()) {
  const transport = createTransport()
  let now = 1_700_000_000_000
  const controller = new ReviewCoachSessionController(transport, storage, () => (now += 1000))
  return { controller, transport, storage }
}

const storedRecord = (storage: ReturnType<typeof createStorage>) =>
  storage.values.get(`${REVIEW_STORAGE_NAMESPACE}:${reviewCoachStorageKey(scope)}`) as
    { version: number; conversations: Array<Record<string, unknown>> } | undefined

describe('ReviewCoachSessionController', () => {
  describe('a first review', () => {
    it('sends the document, shows the answer as it is written and keeps it', async () => {
      const { controller, transport, storage } = createHarness()
      const conversation = controller.open(target())
      const started = controller.start(target(), input)

      expect(conversation.streaming).toBe(true)
      expect(controller.activeKey.value).toBe(controller.keyOf(target()))
      const [call] = transport.calls
      expect(call.request).toEqual({
        requestId: expect.stringMatching(/^[\w-]{1,80}$/),
        system: '你是教练。',
        messages: [{ role: 'user', content: FIRST }]
      })

      write(call, '先说结论：')
      write(call, '补刀落后。')
      expect(conversation.pendingText).toBe('先说结论：补刀落后。')

      call.finish(ok('先说结论：补刀落后。'))
      await started

      expect(conversation).toMatchObject({
        streaming: false,
        pendingText: '',
        error: null,
        incomplete: null,
        model: 'claude-opus-5-5',
        usage: { inputTokens: 9000, outputTokens: 800, cachedInputTokens: 0 },
        saveFailed: false
      })
      expect(conversation.messages).toEqual([
        { role: 'user', content: FIRST },
        { role: 'assistant', content: '先说结论：补刀落后。' }
      ])
      expect(controller.activeKey.value).toBeNull()
      expect(storedRecord(storage)).toMatchObject({
        version: 1,
        conversations: [{ gameId: 100, system: '你是教练。', model: 'claude-opus-5-5' }]
      })
    })

    it('hands plain data to the provider, never reactive objects', async () => {
      const { controller, transport } = createHarness()
      void controller.start(target(), input)

      const { request } = transport.calls[0]
      expect(isReactive(request.messages)).toBe(false)
      expect(isReactive(request.messages[0])).toBe(false)
      expect(() => structuredClone(request)).not.toThrow()
    })

    it('returns the same conversation whenever the game is opened again', async () => {
      const { controller, transport } = createHarness()
      const first = controller.open(target())
      const started = controller.start(target(), input)

      // The player switched to the timeline and came back while the answer was being written.
      const again = controller.open(target())
      expect(again).toBe(first)
      write(transport.calls[0], '还在写')
      expect(again.pendingText).toBe('还在写')

      transport.calls[0].finish(ok('写完了'))
      await started
      expect(controller.open(target()).messages).toHaveLength(2)
    })

    it('marks an answer that hit the length limit', async () => {
      const { controller, transport } = createHarness()
      const started = controller.start(target(), input)
      transport.calls[0].finish(ok('说到一半', { truncated: true }))
      await started

      expect(controller.open(target()).incomplete).toBe('length')
    })
  })

  describe('follow-up questions', () => {
    async function reviewed() {
      const harness = createHarness()
      const started = harness.controller.start(target(), input)
      harness.transport.calls[0].finish(ok('第一次回答。'))
      await started
      return harness
    }

    it('resends the whole exchange with the document unchanged', async () => {
      const { controller, transport, storage } = await reviewed()
      const asked = controller.ask(target(), '  对线期怎么打更好？ ')

      expect(transport.calls[1].request.messages).toEqual([
        { role: 'user', content: FIRST },
        { role: 'assistant', content: '第一次回答。' },
        { role: 'user', content: '对线期怎么打更好？' }
      ])
      expect(transport.calls[1].request.system).toBe('你是教练。')
      expect(transport.calls[1].request.requestId).not.toBe(transport.calls[0].request.requestId)

      transport.calls[1].finish(ok('多控线。'))
      await asked
      expect(controller.open(target()).messages).toHaveLength(4)
      expect(storedRecord(storage)!.conversations[0].messages).toHaveLength(4)
    })

    it('ignores an empty question and a question during an answer', async () => {
      const { controller, transport } = await reviewed()

      await controller.ask(target(), '   ')
      expect(transport.calls).toHaveLength(1)

      void controller.ask(target(), '第一个问题')
      await controller.ask(target(), '第二个问题')
      expect(transport.calls).toHaveLength(2)
      expect(controller.open(target()).messages.at(-1)).toEqual({
        role: 'user',
        content: '第一个问题'
      })
    })

    it('replaces a question that got no answer with the next one', async () => {
      const { controller, transport, storage } = await reviewed()
      const asked = controller.ask(target(), '问错了的问题')
      transport.calls[1].finish(failed('network', '', 'net::ERR_FAILED'))
      await asked

      const conversation = controller.open(target())
      expect(conversation.error).toEqual({ code: 'network', message: 'net::ERR_FAILED' })
      expect(conversation.messages).toHaveLength(3)
      // What is kept on this device never ends with an unanswered question.
      expect(storedRecord(storage)!.conversations[0].messages).toHaveLength(2)

      const again = controller.ask(target(), '换一个问题')
      expect(transport.calls[2].request.messages).toEqual([
        { role: 'user', content: FIRST },
        { role: 'assistant', content: '第一次回答。' },
        { role: 'user', content: '换一个问题' }
      ])
      transport.calls[2].finish(ok('回答。'))
      await again
      expect(conversation.error).toBeNull()
      expect(conversation.messages).toHaveLength(4)
    })

    it('sends the same question again on retry', async () => {
      const { controller, transport } = await reviewed()
      const asked = controller.ask(target(), '我的出装顺序有问题吗？')
      transport.calls[1].finish(failed('rate-limit'))
      await asked

      const retried = controller.retry(target())
      expect(transport.calls[2].request.messages).toEqual(transport.calls[1].request.messages)
      transport.calls[2].finish(ok('没问题。'))
      await retried

      // Nothing to retry once it is answered.
      await controller.retry(target())
      expect(transport.calls).toHaveLength(3)
    })

    it('stops taking questions when the conversation is full', async () => {
      const { controller, transport } = await reviewed()
      const conversation = controller.open(target())
      while (conversation.messages.length + 2 <= AI_COACH_MAX_MESSAGES) {
        conversation.messages.push(
          { role: 'user', content: '问' },
          { role: 'assistant', content: '答' }
        )
      }
      expect(conversation.messages).toHaveLength(AI_COACH_MAX_MESSAGES)
      expect(canAskReviewCoach(conversation)).toBe(false)

      await controller.ask(target(), '再问一个')
      expect(transport.calls).toHaveLength(1)
    })
  })

  describe('when a request does not produce an answer', () => {
    it('keeps the first request for a retry and shows what went wrong', async () => {
      const { controller, transport, storage } = createHarness()
      const started = controller.start(target(), input)
      transport.calls[0].finish(failed('auth', '', 'invalid key'))
      await started

      const conversation = controller.open(target())
      expect(conversation).toMatchObject({
        streaming: false,
        error: { code: 'auth', message: 'invalid key' }
      })
      expect(conversation.messages).toEqual([{ role: 'user', content: FIRST }])
      expect(canAskReviewCoach(conversation)).toBe(false)
      expect(storedRecord(storage)).toBeUndefined()

      // A typed question cannot replace the game document.
      await controller.ask(target(), '换个问题')
      expect(transport.calls).toHaveLength(1)

      const retried = controller.retry(target())
      transport.calls[1].finish(ok('这次成功了。'))
      await retried
      expect(conversation.error).toBeNull()
      expect(conversation.messages).toHaveLength(2)
    })

    it('keeps what had been written visible next to the error', async () => {
      const { controller, transport } = createHarness()
      const started = controller.start(target(), input)
      write(transport.calls[0], '写了一半')
      transport.calls[0].finish(failed('server', '写了一半', 'Overloaded'))
      await started

      const conversation = controller.open(target())
      expect(conversation.pendingText).toBe('写了一半')
      expect(conversation.error).toEqual({ code: 'server', message: 'Overloaded' })
      expect(conversation.messages).toHaveLength(1)
    })

    it('treats a call that breaks as a failure', async () => {
      const storage = createStorage()
      const controller = new ReviewCoachSessionController(
        {
          chat: async () => {
            throw new Error('ipc closed')
          },
          cancel: () => {}
        },
        storage
      )

      await controller.start(target(), input)

      expect(controller.open(target())).toMatchObject({
        streaming: false,
        error: { code: 'unknown', message: '' }
      })
      expect(controller.activeKey.value).toBeNull()
    })
  })

  describe('stopping', () => {
    it('keeps the part already written as the answer', async () => {
      const { controller, transport, storage } = createHarness()
      const started = controller.start(target(), input)
      write(transport.calls[0], '看了前半段就够了')

      controller.stop(target())
      await started

      const conversation = controller.open(target())
      expect(transport.cancelled).toEqual([transport.calls[0].request.requestId])
      expect(conversation).toMatchObject({ streaming: false, error: null, incomplete: 'stopped' })
      expect(conversation.messages.at(-1)).toEqual({
        role: 'assistant',
        content: '看了前半段就够了'
      })
      expect(storedRecord(storage)!.conversations[0]).toMatchObject({ incomplete: 'stopped' })
      // It can be continued like any other answer.
      expect(canAskReviewCoach(conversation)).toBe(true)
    })

    it('reports a stop before anything was written as stopped, with a retry', async () => {
      const { controller, transport, storage } = createHarness()
      const started = controller.start(target(), input)

      controller.stop(target())
      await started

      const conversation = controller.open(target())
      expect(conversation.error).toEqual({ code: 'cancelled', message: '' })
      expect(conversation.messages).toHaveLength(1)
      expect(storedRecord(storage)).toBeUndefined()
      expect(transport.calls).toHaveLength(1)
    })

    it('does nothing when no answer is being written', () => {
      const { controller, transport } = createHarness()

      controller.stop(target())
      controller.open(target())
      controller.stop(target())

      expect(transport.cancel).not.toHaveBeenCalled()
    })
  })

  describe('one answer at a time', () => {
    it('does not send a second request while another game is being answered', async () => {
      const { controller, transport } = createHarness()
      const first = controller.start(target(100), input)

      await controller.start(target(200), input)

      expect(transport.calls).toHaveLength(1)
      expect(controller.open(target(200))).toMatchObject({
        streaming: false,
        error: { code: 'busy', message: '' }
      })
      expect(controller.open(target(100)).streaming).toBe(true)

      transport.calls[0].finish(ok('第一局的回答。'))
      await first
      const retried = controller.retry(target(200))
      expect(transport.calls).toHaveLength(2)
      transport.calls[1].finish(ok('第二局的回答。'))
      await retried
      expect(controller.open(target(200)).messages.at(-1)!.content).toBe('第二局的回答。')
      expect(controller.open(target(100)).messages.at(-1)!.content).toBe('第一局的回答。')
    })
  })

  describe('what is kept on this device', () => {
    it('shows the saved conversation after a restart and continues it', async () => {
      const storage = createStorage()
      const before = createHarness(storage)
      const started = before.controller.start(target(), input)
      before.transport.calls[0].finish(ok('上次的回答。', { truncated: true }))
      await started

      const after = createHarness(storage)
      const conversation = after.controller.open(target())
      expect(conversation.loaded).toBe(false)
      await vi.waitFor(() => expect(conversation.loaded).toBe(true))

      expect(conversation.messages).toEqual([
        { role: 'user', content: FIRST },
        { role: 'assistant', content: '上次的回答。' }
      ])
      expect(conversation).toMatchObject({
        system: '你是教练。',
        incomplete: 'length',
        model: 'claude-opus-5-5'
      })

      const asked = after.controller.ask(target(), '接着问')
      expect(after.transport.calls[0].request.messages[0]).toEqual({ role: 'user', content: FIRST })
      after.transport.calls[0].finish(ok('接着答。'))
      await asked
      expect(storedRecord(storage)!.conversations).toHaveLength(1)
      expect(storedRecord(storage)!.conversations[0].messages).toHaveLength(4)
    })

    it('keeps the conversations of different games apart', async () => {
      const storage = createStorage()
      const { controller, transport } = createHarness(storage)
      const first = controller.start(target(100), input)
      transport.calls[0].finish(ok('第一局。'))
      await first
      const second = controller.start(target(200), input)
      transport.calls[1].finish(ok('第二局。'))
      await second

      storage.get.mockClear()
      const after = createHarness(storage)
      const one = after.controller.open(target(100))
      const two = after.controller.open(target(200))
      const none = after.controller.open(target(300))
      await vi.waitFor(() => expect(one.loaded && two.loaded && none.loaded).toBe(true))

      expect(one.messages.at(-1)!.content).toBe('第一局。')
      expect(two.messages.at(-1)!.content).toBe('第二局。')
      expect(none.messages).toEqual([])
      // One read serves every game of the account.
      expect(storage.get).toHaveBeenCalledTimes(1)
    })

    it('keeps the most recent conversations and drops the oldest', async () => {
      const storage = createStorage()
      const { controller, transport } = createHarness(storage)
      for (let index = 0; index < REVIEW_COACH_MAX_SAVED_CONVERSATIONS + 3; index++) {
        const started = controller.start(target(1000 + index), input)
        transport.calls[index].finish(ok(`回答 ${index}`))
        await started
      }

      const ids = storedRecord(storage)!.conversations.map((item) => item.gameId)
      expect(ids).toHaveLength(REVIEW_COACH_MAX_SAVED_CONVERSATIONS)
      expect(ids[0]).toBe(1000 + REVIEW_COACH_MAX_SAVED_CONVERSATIONS + 2)
      expect(ids).not.toContain(1000)
      expect(ids).not.toContain(1002)
      expect(ids).toContain(1003)
    })

    it('forgets a conversation on reset, here and on disk', async () => {
      const storage = createStorage()
      const { controller, transport } = createHarness(storage)
      const first = controller.start(target(100), input)
      transport.calls[0].finish(ok('第一局。'))
      await first
      const second = controller.start(target(200), input)
      transport.calls[1].finish(ok('第二局。'))
      await second

      await controller.reset(target(100))

      expect(controller.open(target(100))).toMatchObject({
        loaded: true,
        messages: [],
        error: null
      })
      expect(storedRecord(storage)!.conversations.map((item) => item.gameId)).toEqual([200])
    })

    it('ends an answer that is being written before forgetting the conversation', async () => {
      const { controller, transport } = createHarness()
      const started = controller.start(target(), input)
      write(transport.calls[0], '写到一半')

      await controller.reset(target())
      await started

      expect(transport.cancelled).toHaveLength(1)
      expect(controller.open(target())).toMatchObject({ streaming: false, messages: [] })
      expect(controller.activeKey.value).toBeNull()

      // Free for a new review straight away.
      void controller.start(target(), input)
      expect(transport.calls).toHaveLength(2)
    })

    it('goes back to the saved conversation when a new review fails', async () => {
      const storage = createStorage()
      const { controller, transport } = createHarness(storage)
      const first = controller.start(target(), input)
      transport.calls[0].finish(ok('原来的回答。'))
      await first

      const redo = controller.start(target(), {
        ...input,
        firstMessage: `${FIRST}\n\n我特别想了解：出装`
      })
      transport.calls[1].finish(failed('network'))
      await redo
      const conversation = controller.open(target())
      expect(conversation.messages).toHaveLength(1)
      expect(conversation.error).not.toBeNull()

      await controller.restore(target())

      expect(conversation.error).toBeNull()
      expect(conversation.messages).toEqual([
        { role: 'user', content: FIRST },
        { role: 'assistant', content: '原来的回答。' }
      ])
    })

    it('goes back to an empty start when nothing was saved', async () => {
      const { controller, transport } = createHarness()
      const started = controller.start(target(), input)
      transport.calls[0].finish(failed('auth'))
      await started

      await controller.restore(target())

      expect(controller.open(target())).toMatchObject({ loaded: true, messages: [], error: null })
    })

    it('works without a known account, in memory only', async () => {
      const storage = createStorage()
      const { controller, transport } = createHarness(storage)
      const unsaved = target(100, { scope: null })
      const started = controller.start(unsaved, input)
      transport.calls[0].finish(ok('没有账号也能答。'))
      await started

      expect(controller.open(unsaved)).toMatchObject({ loaded: true, saveFailed: false })
      expect(controller.open(unsaved).messages).toHaveLength(2)
      expect(storage.set).not.toHaveBeenCalled()
      expect(storage.get).not.toHaveBeenCalled()
      // Not mixed up with the same game under a known account.
      expect(controller.keyOf(unsaved)).not.toBe(controller.keyOf(target(100)))
    })

    it('says so when the conversation could not be saved, and keeps it usable', async () => {
      const storage = createStorage()
      storage.set.mockRejectedValue(new Error('disk full'))
      const { controller, transport } = createHarness(storage)
      const started = controller.start(target(), input)
      transport.calls[0].finish(ok('回答。'))
      await started

      const conversation = controller.open(target())
      expect(conversation.saveFailed).toBe(true)
      expect(conversation.messages).toHaveLength(2)

      storage.set.mockImplementation(async (namespace, key, value) => {
        storage.values.set(`${namespace}:${key}`, structuredClone(value))
      })
      const asked = controller.ask(target(), '再问')
      transport.calls[1].finish(ok('再答。'))
      await asked
      expect(conversation.saveFailed).toBe(false)
      expect(storedRecord(storage)!.conversations[0].messages).toHaveLength(4)
    })

    it.each([
      ['is not an object', 'text'],
      ['has another layout', { version: 2, conversations: [] }],
      ['has no list', { version: 1 }]
    ])('starts empty when the saved record %s', async (_, record) => {
      const storage = createStorage({
        [`${REVIEW_STORAGE_NAMESPACE}:${reviewCoachStorageKey(scope)}`]: record
      })
      const { controller } = createHarness(storage)
      const conversation = controller.open(target())

      await vi.waitFor(() => expect(conversation.loaded).toBe(true))
      expect(conversation.messages).toEqual([])
    })

    it('starts empty when the saved record cannot be read', async () => {
      const storage = createStorage()
      storage.get.mockRejectedValue(new Error('read failed'))
      const { controller } = createHarness(storage)
      const conversation = controller.open(target())

      await vi.waitFor(() => expect(conversation.loaded).toBe(true))
      expect(conversation.messages).toEqual([])
    })

    it('skips saved conversations that are not complete exchanges', async () => {
      const exchange = [
        { role: 'user', content: FIRST },
        { role: 'assistant', content: '回答。' }
      ]
      const base = { system: '你是教练。', updatedAt: 1, messages: exchange }
      const storage = createStorage({
        [`${REVIEW_STORAGE_NAMESPACE}:${reviewCoachStorageKey(scope)}`]: {
          version: 1,
          conversations: [
            { ...base, gameId: 1 },
            { ...base, gameId: 2, messages: [exchange[0]] },
            { ...base, gameId: 3, messages: [exchange[1], exchange[0]] },
            { ...base, gameId: 4, messages: [exchange[0], { role: 'assistant', content: '  ' }] },
            { ...base, gameId: 5, system: 42 },
            { ...base, gameId: 'six' },
            { ...base, gameId: 7, updatedAt: 'yesterday' },
            null,
            { ...base, gameId: 8, incomplete: 'weird', usage: { inputTokens: 'many' }, model: 9 }
          ]
        }
      })
      const { controller } = createHarness(storage)
      const conversations = [1, 2, 3, 4, 5, 7, 8].map((gameId) => controller.open(target(gameId)))

      await vi.waitFor(() => expect(conversations.every((item) => item.loaded)).toBe(true))
      expect(conversations.map((item) => item.messages.length)).toEqual([2, 0, 0, 0, 0, 0, 2])
      // Unknown details of a usable record fall back to "not known".
      expect(conversations.at(-1)).toMatchObject({
        incomplete: null,
        model: null,
        usage: { inputTokens: null, outputTokens: null, cachedInputTokens: null }
      })
    })

    it('does not let a late read replace a review that already started', async () => {
      const storage = createStorage({
        [`${REVIEW_STORAGE_NAMESPACE}:${reviewCoachStorageKey(scope)}`]: {
          version: 1,
          conversations: [
            {
              gameId: 100,
              system: '旧提示',
              updatedAt: 1,
              messages: [
                { role: 'user', content: '旧资料' },
                { role: 'assistant', content: '旧回答' }
              ]
            }
          ]
        }
      })
      let release = () => {}
      const gate = new Promise<void>((resolve) => (release = resolve))
      const read = storage.get.getMockImplementation()!
      storage.get.mockImplementation(async (...args) => {
        await gate
        return read(...args)
      })
      const { controller, transport } = createHarness(storage)
      const conversation = controller.open(target())

      const started = controller.start(target(), input)
      release()
      await vi.waitFor(() => expect(transport.calls).toHaveLength(1))
      await Promise.resolve()
      expect(conversation.messages).toEqual([{ role: 'user', content: FIRST }])

      transport.calls[0].finish(ok('新回答'))
      await started
      expect(conversation.messages.at(-1)!.content).toBe('新回答')
      expect(storedRecord(storage)!.conversations[0].system).toBe('你是教练。')
    })
  })
})
