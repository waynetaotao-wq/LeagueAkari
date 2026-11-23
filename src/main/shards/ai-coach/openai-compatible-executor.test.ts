import type { ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'

import type { AiCoachExecuteInput } from './context'
import { executeOpenAiCompatibleChat } from './openai-compatible-executor'
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

const KEY = 'sk-test-0123456789abcdef'
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
  const result = executeOpenAiCompatibleChat({
    apiKey: KEY,
    model: 'deepseek-chat',
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

const delta = (content: string): SseEvent => ({
  data: { choices: [{ index: 0, delta: { content }, finish_reason: null }] }
})
const finish = (finishReason = 'stop', usage?: Record<string, unknown>): SseEvent => ({
  data: { choices: [{ index: 0, delta: {}, finish_reason: finishReason }], ...(usage && { usage }) }
})
const DONE: SseEvent = { data: '[DONE]' }

describe('executeOpenAiCompatibleChat', () => {
  it('streams the answer and reports what was used', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [
        { data: { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] } },
        delta('先说结论：'),
        delta('补刀落后。'),
        finish('stop', {
          prompt_tokens: 900,
          completion_tokens: 30,
          prompt_tokens_details: { cached_tokens: 640 }
        }),
        DONE
      ])
    )

    const { result, deltas } = run(`${server.url}/v1`)

    await expect(result).resolves.toEqual({
      result: 'ok',
      text: '先说结论：补刀落后。',
      truncated: false,
      usage: { inputTokens: 900, outputTokens: 30, cachedInputTokens: 640 },
      model: 'deepseek-chat'
    })
    expect(deltas).toEqual(['先说结论：', '补刀落后。'])
  })

  it('sends the conversation in the chat-completions shape', async () => {
    const server = await serve((_, response) => sendSse(response, [delta('好。'), finish(), DONE]))

    await run(`${server.url}/v1`, {
      messages: [
        { role: 'user', content: '这是对局资料。' },
        { role: 'assistant', content: '第一次回答。' },
        { role: 'user', content: '再讲讲第二条。' }
      ]
    }).result

    const [request] = server.requests
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/v1/chat/completions')
    expect(request.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(request.headers['content-type']).toBe('application/json')
    expect(request.url + request.body).not.toContain(KEY)
    expect(JSON.parse(request.body)).toEqual({
      model: 'deepseek-chat',
      stream: true,
      messages: [
        { role: 'system', content: '你是教练。' },
        { role: 'user', content: '这是对局资料。' },
        { role: 'assistant', content: '第一次回答。' },
        { role: 'user', content: '再讲讲第二条。' }
      ]
    })
  })

  it('leaves the system message out when there is none', async () => {
    const server = await serve((_, response) => sendSse(response, [delta('好。'), finish(), DONE]))

    await run(server.url, { system: '' }).result

    expect(JSON.parse(server.requests[0].body).messages).toEqual([
      { role: 'user', content: '这是对局资料。' }
    ])
  })

  it('accepts an address that already names the chat endpoint', async () => {
    const server = await serve((_, response) => sendSse(response, [delta('好。'), finish(), DONE]))

    await run(`${server.url}/api/v3/chat/completions`).result

    expect(server.requests[0].url).toBe('/api/v3/chat/completions')
  })

  it('puts together characters that arrive cut in half', async () => {
    const bytes = Buffer.from(formatSse([delta('补刀落后十五个。'), finish(), DONE]), 'utf8')
    const server = await serve(async (_, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      // Three bytes per character: slices of seven bytes cut most of them apart.
      for (let offset = 0; offset < bytes.length; offset += 7) {
        response.write(bytes.subarray(offset, offset + 7))
        await wait(1)
      }
      response.end()
    })

    await expect(run(server.url).result).resolves.toMatchObject({
      result: 'ok',
      text: '补刀落后十五个。'
    })
  })

  it('reads a whole reply from a service that ignores the streaming switch', async () => {
    const server = await serve((_, response) =>
      sendJson(response, 200, {
        model: 'local-model:latest',
        choices: [
          { message: { role: 'assistant', content: '一次给完的回答。' }, finish_reason: 'stop' }
        ],
        usage: { prompt_tokens: 12, completion_tokens: 8 }
      })
    )

    const { result, deltas } = run(server.url)

    await expect(result).resolves.toEqual({
      result: 'ok',
      text: '一次给完的回答。',
      truncated: false,
      usage: { inputTokens: 12, outputTokens: 8, cachedInputTokens: null },
      model: 'local-model:latest'
    })
    expect(deltas).toEqual(['一次给完的回答。'])
  })

  it('reports unknown usage when the service does not count', async () => {
    const server = await serve((_, response) => sendSse(response, [delta('好。'), finish(), DONE]))

    await expect(run(server.url).result).resolves.toMatchObject({
      result: 'ok',
      usage: { inputTokens: null, outputTokens: null, cachedInputTokens: null }
    })
  })

  it('marks an answer cut short by the length limit', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [delta('说到一半'), finish('length'), DONE])
    )

    await expect(run(server.url).result).resolves.toMatchObject({
      result: 'ok',
      text: '说到一半',
      truncated: true
    })
  })

  it('reports a filtered answer as refused', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [delta('抱歉'), finish('content_filter'), DONE])
    )

    await expect(run(server.url).result).resolves.toMatchObject({
      result: 'failed',
      code: 'refused',
      text: '抱歉'
    })
  })

  it.each([
    ['nothing at all', [DONE]],
    [
      'only its reasoning',
      [{ data: { choices: [{ delta: { reasoning_content: '想了很多' } }] } }, finish(), DONE]
    ]
  ] as [string, SseEvent[]][])('reports an answer with %s as empty', async (_, events) => {
    const server = await serve((_request, response) => sendSse(response, events))

    await expect(run(server.url).result).resolves.toMatchObject({ result: 'failed', code: 'empty' })
  })

  it.each([
    [400, 'bad-request'],
    [401, 'auth'],
    [402, 'billing'],
    [403, 'permission'],
    [404, 'not-found'],
    [405, 'not-found'],
    [408, 'timeout'],
    [413, 'too-large'],
    [422, 'bad-request'],
    [429, 'rate-limit'],
    [500, 'server'],
    [503, 'server']
  ] as const)('classifies HTTP %i as %s', async (status, code) => {
    const server = await serve((_, response) =>
      sendJson(response, status, { error: { message: 'what the service said', type: 'x' } })
    )

    await expect(run(server.url).result).resolves.toEqual({
      result: 'failed',
      code,
      message: 'what the service said',
      text: ''
    })
    // Nothing is retried silently: the user decides whether to try again.
    expect(server.requests).toHaveLength(1)
  })

  it.each([
    ['an error object', { error: { message: 'model not found' } }, 'model not found'],
    ['a plain message', { message: 'quota used up' }, 'quota used up'],
    ['an error string', { error: 'bad key' }, 'bad key'],
    ['plain text', 'upstream unavailable', 'upstream unavailable']
  ])('reads the explanation from %s', async (_, body, message) => {
    const server = await serve((_request, response) => sendJson(response, 400, body))

    await expect(run(server.url).result).resolves.toMatchObject({ message })
  })

  it('never lets the key appear in an error message and keeps the message short', async () => {
    const server = await serve((_, response) =>
      sendJson(response, 401, {
        error: { message: `Incorrect API key ${KEY} ${'x'.repeat(2000)}` }
      })
    )

    const result = await run(server.url).result

    expect(result).toMatchObject({ code: 'auth' })
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(result.result === 'failed' && result.message.startsWith('Incorrect API key ***')).toBe(
      true
    )
    expect(result.result === 'failed' && result.message.length).toBeLessThanOrEqual(300)
  })

  it('keeps what was written when the service fails in the middle of the answer', async () => {
    const server = await serve((_, response) =>
      sendSse(response, [delta('写了一半'), { data: { error: { message: 'model overloaded' } } }])
    )

    await expect(run(server.url).result).resolves.toEqual({
      result: 'failed',
      code: 'server',
      message: 'model overloaded',
      text: '写了一半'
    })
  })

  it('reports an error wrapped in a successful reply', async () => {
    const server = await serve((_, response) =>
      sendJson(response, 200, { error: { message: 'insufficient balance' } })
    )

    await expect(run(server.url).result).resolves.toMatchObject({
      result: 'failed',
      code: 'server',
      message: 'insufficient balance'
    })
  })

  it('recognises a web page as a wrong address', async () => {
    const server = await serve((_, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>Welcome</title>')
    })

    await expect(run(server.url).result).resolves.toMatchObject({
      result: 'failed',
      code: 'not-found'
    })
  })

  it('does not send anything to an address it cannot use', async () => {
    let called = false

    await expect(
      run('http://api.example.com/v1', {
        fetch: async () => {
          called = true
          return new Response('')
        }
      }).result
    ).resolves.toMatchObject({ result: 'failed', code: 'not-configured' })
    expect(called).toBe(false)
  })

  it('stops when cancelled and hands back what had arrived', async () => {
    let open: ServerResponse | null = null
    const server = await serve((_, response) => {
      open = response
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(formatSse([delta('刚开了个头')]))
    })

    const { result, deltas, controller } = run(server.url)
    while (!deltas.length) await wait(5)
    controller.abort()

    await expect(result).resolves.toEqual({
      result: 'failed',
      code: 'cancelled',
      message: '',
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
