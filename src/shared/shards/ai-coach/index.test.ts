import { describe, expect, it } from 'vitest'

import {
  AI_COACH_MAX_KEY_LENGTH,
  AI_COACH_MAX_MESSAGES,
  AI_COACH_MAX_REQUEST_CHARS,
  AI_COACH_OPENAI_PRESETS,
  createSseDataParser,
  isAiCoachProvider,
  normalizeAiCoachBaseUrl,
  normalizeAiCoachKey,
  readOpenAiStreamChunk,
  readOpenAiUsage,
  redactAiCoachSecret,
  resolveOpenAiChatUrl,
  validateAiCoachRequest
} from './index'

describe('normalizeAiCoachKey', () => {
  it('trims what was pasted', () => {
    expect(normalizeAiCoachKey('  sk-abc123456789\n')).toBe('sk-abc123456789')
  })

  it.each([
    ['nothing', undefined],
    ['a number', 12345678],
    ['too short', 'sk-12'],
    ['blanks inside', 'sk-abc 123456789'],
    ['a line break inside', 'sk-abc\n123456789'],
    ['non-ASCII characters', 'sk-密钥abc12345678'],
    ['too long', 'k'.repeat(AI_COACH_MAX_KEY_LENGTH + 1)]
  ])('rejects %s', (_, value) => {
    expect(normalizeAiCoachKey(value)).toBeNull()
  })
})

describe('normalizeAiCoachBaseUrl', () => {
  it.each([
    ['https://api.deepseek.com', 'https://api.deepseek.com'],
    ['  https://api.openai.com/v1/  ', 'https://api.openai.com/v1'],
    ['https://example.com/v1?x=1#top', 'https://example.com/v1'],
    ['http://localhost:11434/v1', 'http://localhost:11434/v1'],
    ['http://127.0.0.1:1234', 'http://127.0.0.1:1234']
  ])('cleans %s', (value, expected) => {
    expect(normalizeAiCoachBaseUrl(value)).toBe(expected)
  })

  it.each([
    ['plain http to a remote host', 'http://api.example.com/v1'],
    ['another protocol', 'ftp://example.com'],
    ['credentials in the address', 'https://user:pass@example.com/v1'],
    ['not an address', 'deepseek'],
    ['nothing', ''],
    ['a number', 42]
  ])('rejects %s', (_, value) => {
    expect(normalizeAiCoachBaseUrl(value)).toBeNull()
  })

  it('accepts every built-in address', () => {
    for (const preset of AI_COACH_OPENAI_PRESETS)
      expect(normalizeAiCoachBaseUrl(preset.baseUrl)).toBe(preset.baseUrl)
  })
})

describe('resolveOpenAiChatUrl', () => {
  it.each([
    ['https://api.deepseek.com', 'https://api.deepseek.com/chat/completions'],
    ['https://api.openai.com/v1/', 'https://api.openai.com/v1/chat/completions'],
    ['https://example.com/v1/chat/completions', 'https://example.com/v1/chat/completions']
  ])('turns %s into %s', (value, expected) => {
    expect(resolveOpenAiChatUrl(value)).toBe(expected)
  })

  it('has no endpoint for an unusable address', () => {
    expect(resolveOpenAiChatUrl('http://api.example.com')).toBeNull()
  })
})

describe('validateAiCoachRequest', () => {
  const request = (values: Record<string, unknown> = {}) => ({
    requestId: 'review-1',
    system: 'You are a coach.',
    messages: [{ role: 'user', content: 'Review this game.' }],
    ...values
  })

  it('accepts a first question and a follow-up', () => {
    expect(validateAiCoachRequest(request())).toBeNull()
    expect(
      validateAiCoachRequest(
        request({
          messages: [
            { role: 'user', content: 'a' },
            { role: 'assistant', content: 'b' },
            { role: 'user', content: 'c' }
          ]
        })
      )
    ).toBeNull()
  })

  it.each([
    ['nothing', null],
    ['a bad id', request({ requestId: 'has spaces' })],
    ['no system prompt', request({ system: undefined })],
    ['no messages', request({ messages: [] })],
    ['an unknown role', request({ messages: [{ role: 'system', content: 'x' }] })],
    ['an empty message', request({ messages: [{ role: 'user', content: '  ' }] })],
    ['an assistant message first', request({ messages: [{ role: 'assistant', content: 'x' }] })],
    [
      'two user messages in a row',
      request({
        messages: [
          { role: 'user', content: 'a' },
          { role: 'user', content: 'b' }
        ]
      })
    ],
    [
      'an assistant message last',
      request({
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' }
        ]
      })
    ],
    [
      'too many messages',
      request({
        messages: Array.from({ length: AI_COACH_MAX_MESSAGES + 1 }, (_, index) => ({
          role: index % 2 ? 'assistant' : 'user',
          content: 'x'
        }))
      })
    ],
    [
      'too much text',
      request({ messages: [{ role: 'user', content: 'x'.repeat(AI_COACH_MAX_REQUEST_CHARS) }] })
    ]
  ])('rejects %s', (_, value) => {
    expect(validateAiCoachRequest(value)).toEqual(expect.any(String))
  })
})

describe('createSseDataParser', () => {
  const collect = (chunks: string[]) => {
    const events: string[] = []
    const parser = createSseDataParser((data) => events.push(data))
    chunks.forEach((chunk) => parser.push(chunk))
    parser.flush()
    return events
  }

  it('reads one event per blank line', () => {
    expect(collect(['data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n'])).toEqual([
      '{"a":1}',
      '{"a":2}',
      '[DONE]'
    ])
  })

  it('reassembles events cut at any byte', () => {
    const text = 'data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n'
    for (let size = 1; size <= 7; size++) {
      const chunks = text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g'))!
      expect(collect(chunks)).toEqual(['{"a":1}', '{"b":2}'])
    }
  })

  it('joins several data lines and ignores other fields and comments', () => {
    expect(collect([': keep-alive\nevent: message\ndata: first\ndata: second\nid: 7\n\n'])).toEqual(
      ['first\nsecond']
    )
  })

  it('keeps the last event when the stream ends without a blank line', () => {
    expect(collect(['data: {"a":1}\n\ndata: tail'])).toEqual(['{"a":1}', 'tail'])
  })

  it('accepts a field without a space after the colon', () => {
    expect(collect(['data:{"a":1}\n\n'])).toEqual(['{"a":1}'])
  })
})

describe('readOpenAiStreamChunk', () => {
  it('reads a text delta', () => {
    expect(
      readOpenAiStreamChunk('{"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}')
    ).toEqual({ done: false, text: '你好', finishReason: null, usage: null, error: null })
  })

  it('reads the finish reason and the usage of the last chunk', () => {
    expect(
      readOpenAiStreamChunk(
        '{"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":900,"completion_tokens":300,"prompt_tokens_details":{"cached_tokens":640}}}'
      )
    ).toMatchObject({
      text: '',
      finishReason: 'length',
      usage: { inputTokens: 900, outputTokens: 300, cachedInputTokens: 640 }
    })
  })

  it('recognises the end marker and an error object', () => {
    expect(readOpenAiStreamChunk(' [DONE] ')).toMatchObject({ done: true })
    expect(readOpenAiStreamChunk('{"error":{"message":"model overloaded"}}')).toMatchObject({
      error: 'model overloaded'
    })
    expect(readOpenAiStreamChunk('{"error":"quota exceeded"}')).toMatchObject({
      error: 'quota exceeded'
    })
  })

  it('ignores chunks without text and reasoning-only deltas', () => {
    expect(readOpenAiStreamChunk('{"choices":[]}')).toMatchObject({ text: '', done: false })
    expect(
      readOpenAiStreamChunk('{"choices":[{"delta":{"reasoning_content":"thinking"}}]}')
    ).toMatchObject({ text: '' })
  })

  it('does not understand what is not JSON', () => {
    expect(readOpenAiStreamChunk('not json')).toBeNull()
    expect(readOpenAiStreamChunk('42')).toBeNull()
  })
})

describe('readOpenAiUsage', () => {
  it('reads the cache counter under either name', () => {
    expect(
      readOpenAiUsage({ prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 8 })
    ).toEqual({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 8 })
  })

  it('has nothing to report without token counts', () => {
    expect(readOpenAiUsage(null)).toBeNull()
    expect(readOpenAiUsage({})).toBeNull()
    expect(readOpenAiUsage({ prompt_tokens: 'many' })).toBeNull()
  })
})

describe('small helpers', () => {
  it('knows the two providers', () => {
    expect(isAiCoachProvider('anthropic')).toBe(true)
    expect(isAiCoachProvider('openai-compatible')).toBe(true)
    expect(isAiCoachProvider('openai')).toBe(false)
    expect(isAiCoachProvider(undefined)).toBe(false)
  })

  it('removes every occurrence of the key from a text', () => {
    expect(redactAiCoachSecret('bad key sk-secret, again sk-secret.', 'sk-secret')).toBe(
      'bad key ***, again ***.'
    )
    expect(redactAiCoachSecret('nothing to hide', '')).toBe('nothing to hide')
  })
})
