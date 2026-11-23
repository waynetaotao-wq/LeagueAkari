import {
  type AiCoachChatResult,
  type AiCoachErrorCode,
  type AiCoachUsage,
  createSseDataParser,
  readOpenAiStreamChunk,
  readOpenAiUsage,
  redactAiCoachSecret,
  resolveOpenAiChatUrl
} from '@shared/shards/ai-coach'

import { AI_COACH_MAX_ERROR_MESSAGE_LENGTH, type AiCoachExecuteInput } from './context'

function classifyStatus(status: number): AiCoachErrorCode {
  if (status === 401) return 'auth'
  if (status === 402) return 'billing'
  if (status === 403) return 'permission'
  // 405 多半是地址填成了别的页面，和 404 一样提示检查地址与模型名。
  if (status === 404 || status === 405) return 'not-found'
  if (status === 408) return 'timeout'
  if (status === 413) return 'too-large'
  if (status === 429) return 'rate-limit'
  if (status >= 500) return 'server'
  if (status >= 400) return 'bad-request'
  return 'unknown'
}

/** A whole (non-streamed) reply or an error body: only the fields read here. */
interface OpenAiReplyBody {
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]
  usage?: unknown
  model?: unknown
  message?: unknown
  error?: { message?: unknown } | string | null
}

const parseBody = (body: string): OpenAiReplyBody | null => {
  try {
    const value = JSON.parse(body)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/** The service's own words from an error body, whatever shape it uses. */
function readErrorMessage(body: string) {
  const value = parseBody(body)
  const failure = value?.error
  const message =
    (failure && typeof failure === 'object' ? failure.message : null) ?? value?.message ?? failure
  // 不是 JSON 或没有说明文字：直接取原文的开头。
  return typeof message === 'string' ? message : body.trim()
}

/**
 * Sends one conversation to a service that speaks the OpenAI chat-completions format
 * (DeepSeek, OpenAI, Moonshot, DashScope, OpenRouter, a local Ollama and so on) and streams
 * the answer. Only fields every such service accepts are sent.
 */
export async function executeOpenAiCompatibleChat(
  input: AiCoachExecuteInput
): Promise<AiCoachChatResult> {
  let text = ''
  const failed = (code: AiCoachErrorCode, message = ''): AiCoachChatResult => ({
    result: 'failed',
    code,
    message: redactAiCoachSecret(message, input.apiKey).slice(0, AI_COACH_MAX_ERROR_MESSAGE_LENGTH),
    text
  })

  const url = resolveOpenAiChatUrl(input.baseUrl)
  if (!url) {
    return failed('not-configured')
  }

  try {
    const response = await input.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream, application/json',
        authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          ...(input.system.trim() ? [{ role: 'system', content: input.system }] : []),
          ...input.messages
        ],
        stream: true
      }),
      signal: input.signal
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      return failed(classifyStatus(response.status), readErrorMessage(body))
    }

    let finishReason: string | null = null
    let usage: AiCoachUsage | null = null
    let model = input.model
    let streamError: string | null = null

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('text/html')) {
      // 返回的是网页：地址指到了网站而不是接口。
      return failed('not-found')
    }

    if (contentType.includes('application/json')) {
      // 有的服务不理会流式开关，一次性把整段回答放在 JSON 里返回。
      const body = await response.text()
      const value = parseBody(body)
      if (!value) {
        return failed('server', body.trim())
      }

      const choice = Array.isArray(value.choices) ? value.choices[0] : undefined
      const content = choice?.message?.content
      if (typeof content === 'string') {
        text = content
        input.onDelta(text)
      }
      finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null
      usage = readOpenAiUsage(value.usage)
      if (typeof value.model === 'string') model = value.model
      if (value.error) streamError = readErrorMessage(body)
    } else {
      if (!response.body) {
        return failed('empty')
      }

      const parser = createSseDataParser((data) => {
        const chunk = readOpenAiStreamChunk(data)
        if (!chunk || chunk.done) return
        if (chunk.error) {
          streamError = chunk.error
          return
        }
        if (chunk.text) {
          text += chunk.text
          input.onDelta(chunk.text)
        }
        finishReason = chunk.finishReason ?? finishReason
        usage = chunk.usage ?? usage
      })
      const decoder = new TextDecoder()
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parser.push(decoder.decode(value, { stream: true }))
      }
      parser.push(decoder.decode())
      parser.flush()
    }

    if (streamError) {
      return failed('server', streamError)
    }
    if (finishReason === 'content_filter') {
      return failed('refused')
    }
    if (!text.trim()) {
      return failed('empty')
    }
    return {
      result: 'ok',
      text,
      truncated: finishReason === 'length',
      usage: usage ?? { inputTokens: null, outputTokens: null, cachedInputTokens: null },
      model
    }
  } catch (error) {
    if (input.signal.aborted) {
      return failed('cancelled')
    }
    return failed('network', error instanceof Error ? error.message : String(error))
  }
}
