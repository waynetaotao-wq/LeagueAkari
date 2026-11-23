import { AI_COACH_MAX_OUTPUT_TOKENS } from '@shared/shards/ai-coach'
import type { ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'

import { executeAnthropicChat } from './anthropic-executor'
import type { AiCoachExecuteInput } from './context'
import {
  type SseEvent,
  type TestServerHandler,
  findUnusedAddress,
  formatSse,
  sendJson,
  sendSse,
  startTestServer,
  wait
} from './test-server'

const KEY = 'sk-ant-test-0123456789abcdef'
const cleanups: Array<() => unknown> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function serve(handler: TestServerHandler) {
  const server = await startTestServer(handler)
  cleanups.push(() => server.close())
  return server
}

function run(baseUrl: string, values: Partial<AiCoachExecuteInput> = {}) {
  const deltas: string[] = []
  const controller = new AbortController()
  const result = executeAnthropicChat({
    apiKey: KEY,
    model: 'claude-opus-5-5',
    baseUrl,
    system: '你是教练。',
    messages: [{ role: 'user', content: '这是对局资料。' }],
    signal: controller.signal,
    onDelta: (text) => deltas.push(text),
    fetch: (input, init) => fetch(input, init),
    ...values
  })
  return { result, deltas, controller }
}

const messageStart = (usage: Record<string, number> = {}): SseEvent => ({
  event: 'message_start',
  data: {
    type: 'message_start',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5-20260901',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 30, output_tokens: 1, ...usage }
    }
  }
})

const textBlock = (index: number, pieces: string[]): SseEvent[] => [
  {
    event: 'content_block_start',
    data: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }
  },
  ...pieces.map((text) => ({
    event: 'content_block_delta',
    data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }
  })),
  { event: 'content_block_stop', data: { type: 'content_block_stop', index } }
]

const thinkingBlock = (index: number): SseEvent[] => [
  {
    event: 'content_block_start',
    data: {
      type: 'content_block_start',
      index,
      content_block: { type: 'thinking', thinking: '', signature: '' }
    }
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index,
      delta: { type: 'thinking_delta', thinking: '先看对线期。' }
    }
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index,
      delta: { type: 'signature_delta', signature: 'sig' }
    }
  },
  { event: 'content_block_stop', data: { type: 'content_block_stop', index } }
]

const messageEnd = (stopReason = 'end_turn', outputTokens = 42): SseEvent[] => [
  {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens }
    }
  },
  { event: 'message_stop', data: { type: 'message_stop' } }
]

const apiError = (type: string, message: string) => ({ type: 'error', error: { type, message } })
/** Tells the SDK not to try again, so a test of one failure does not wait for retries. */
const NO_RETRY = { 'x-should-retry': 'false' }

describe('executeAnthropicChat', () => {
  it('streams the answer and reports what was used', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [
        messageStart({ cache_read_input_tokens: 4000, cache_creation_input_tokens: 500 }),
        { event: 'ping', data: { type: 'ping' } },
        ...textBlock(0, ['先说结论：', '对线期', '补刀落后。']),
        ...messageEnd()
      ])
    )

    const { result, deltas } = run(server.url)

    await expect(result).resolves.toEqual({
      result: 'ok',
      text: '先说结论：对线期补刀落后。',
      truncated: false,
      usage: { inputTokens: 4530, outputTokens: 42, cachedInputTokens: 4000 },
      model: 'claude-opus-5-5-20260901'
    })
    expect(deltas).toEqual(['先说结论：', '对线期', '补刀落后。'])
  })

  it('sends the conversation in the shape the Messages API expects', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [messageStart(), ...textBlock(0, ['好。']), ...messageEnd()])
    )

    await run(server.url, {
      messages: [
        { role: 'user', content: '这是对局资料。' },
        { role: 'assistant', content: '第一次回答。' },
        { role: 'user', content: '再讲讲第二条。' }
      ]
    }).result

    const [request] = server.requests
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/v1/messages')
    // The SDK decides how the key is presented; it must travel in a header and nowhere else.
    expect(request.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(request.url + request.body).not.toContain(KEY)
    expect(request.headers['anthropic-version']).toEqual(expect.any(String))
    expect(JSON.parse(request.body)).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: AI_COACH_MAX_OUTPUT_TOKENS,
      stream: true,
      system: '你是教练。',
      messages: [
        {
          role: 'user',
          // The game document is resent unchanged with every follow-up, so it is cached.
          content: [{ type: 'text', text: '这是对局资料。', cache_control: { type: 'ephemeral' } }]
        },
        { role: 'assistant', content: '第一次回答。' },
        { role: 'user', content: '再讲讲第二条。' }
      ]
    })
  })

  it('leaves the system prompt out when there is none', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [messageStart(), ...textBlock(0, ['好。']), ...messageEnd()])
    )

    await run(server.url, { system: '  ' }).result

    expect(JSON.parse(server.requests[0].body)).not.toHaveProperty('system')
  })

  it('goes through the given fetch, so the proxy settings of the app apply', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [messageStart(), ...textBlock(0, ['好。']), ...messageEnd()])
    )
    const urls: string[] = []

    await run(server.url, {
      fetch: (input, init) => {
        urls.push(String(input instanceof Request ? input.url : input))
        return fetch(input, init)
      }
    }).result

    expect(urls).toEqual([`${server.url}/v1/messages`])
  })

  it('keeps the thinking of the model out of the answer', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [
        messageStart(),
        ...thinkingBlock(0),
        ...textBlock(1, ['结论在这里。']),
        ...messageEnd()
      ])
    )

    const { result, deltas } = run(server.url)

    await expect(result).resolves.toMatchObject({ result: 'ok', text: '结论在这里。' })
    expect(deltas).toEqual(['结论在这里。'])
  })

  it.each(['max_tokens', 'model_context_window_exceeded'])(
    'marks an answer cut short by %s',
    async (stopReason) => {
      const server = await serve((_, response) =>
        sendSse(response, [
          messageStart(),
          ...textBlock(0, ['说到一半']),
          ...messageEnd(stopReason)
        ])
      )

      await expect(run(server.url).result).resolves.toMatchObject({
        result: 'ok',
        text: '说到一半',
        truncated: true
      })
    }
  )

  it('reports a refusal instead of presenting it as an answer', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [messageStart(), ...textBlock(0, ['抱歉']), ...messageEnd('refusal')])
    )

    await expect(run(server.url).result).resolves.toEqual({
      result: 'failed',
      code: 'refused',
      message: '',
      text: '抱歉'
    })
  })

  it('reports an answer without any text as empty', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [messageStart(), ...thinkingBlock(0), ...messageEnd()])
    )

    await expect(run(server.url).result).resolves.toMatchObject({ result: 'failed', code: 'empty' })
  })

  it.each([
    [400, 'invalid_request_error', 'bad-request'],
    [401, 'authentication_error', 'auth'],
    [402, 'billing_error', 'billing'],
    [403, 'permission_error', 'permission'],
    [404, 'not_found_error', 'not-found'],
    [413, 'request_too_large', 'too-large'],
    [429, 'rate_limit_error', 'rate-limit'],
    [500, 'api_error', 'server'],
    [529, 'overloaded_error', 'server']
  ] as const)('classifies HTTP %i (%s) as %s', async (status, type, code) => {
    const server = await serve((_, response) =>
      sendJson(response, status, apiError(type, 'what the service said'), NO_RETRY)
    )

    await expect(run(server.url).result).resolves.toEqual({
      result: 'failed',
      code,
      message: 'what the service said',
      text: ''
    })
    expect(server.requests).toHaveLength(1)
  })

  it('never lets the key appear in an error message', async () => {
    const server = await serve((_, response) =>
      sendJson(
        response,
        401,
        apiError('authentication_error', `invalid x-api-key: ${KEY}`),
        NO_RETRY
      )
    )

    const result = await run(server.url).result

    expect(result).toMatchObject({ code: 'auth', message: 'invalid x-api-key: ***' })
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('tries again by itself when the service is briefly overloaded', async () => {
    let calls = 0
    const server = await serve((_, response) => {
      calls++
      if (calls === 1) {
        sendJson(response, 529, apiError('overloaded_error', 'Overloaded'), { 'retry-after': '0' })
      } else {
        sendSse(response, [messageStart(), ...textBlock(0, ['第二次成功。']), ...messageEnd()])
      }
    })

    await expect(run(server.url).result).resolves.toMatchObject({
      result: 'ok',
      text: '第二次成功。'
    })
    expect(server.requests).toHaveLength(2)
  })

  it('keeps what was written when the service fails in the middle of the answer', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [
        messageStart(),
        ...textBlock(0, ['写了一半']).slice(0, 2),
        { event: 'error', data: apiError('overloaded_error', 'Overloaded') }
      ])
    )

    await expect(run(server.url).result).resolves.toEqual({
      result: 'failed',
      code: 'server',
      message: 'Overloaded',
      text: '写了一半'
    })
  })

  it('stops when cancelled and hands back what had arrived', async () => {
    let open: ServerResponse | null = null
    const server = await serve((_, response) => {
      open = response
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      // The first part arrives, then the stream stays open without an end.
      response.write(formatSse([messageStart(), ...textBlock(0, ['刚开了个头']).slice(0, 2)]))
    })

    const { result, deltas, controller } = run(server.url)
    while (!deltas.length) await wait(5)
    controller.abort()

    await expect(result).resolves.toEqual({
      result: 'failed',
      code: 'cancelled',
      message: expect.any(String),
      text: '刚开了个头'
    })
    expect(open).not.toBeNull()
  })

  it('reports a service that cannot be reached as a network problem', async () => {
    const result = await run(await findUnusedAddress()).result

    expect(result).toMatchObject({ result: 'failed', code: 'network', text: '' })
    expect(result.result === 'failed' && result.message).toBeTruthy()
  })
})
