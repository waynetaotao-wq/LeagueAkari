// [lolps] AI 教练：主进程与渲染进程共用的类型和纯逻辑。
// 密钥只在主进程里，任何共用类型都不携带密钥。

export const AI_COACH_PROVIDERS = ['anthropic', 'openai-compatible'] as const
export type AiCoachProvider = (typeof AI_COACH_PROVIDERS)[number]

/** Claude 官方接口可直接选用的模型；也可以手动填写其它模型名。 */
export const AI_COACH_ANTHROPIC_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5'
] as const
export const AI_COACH_DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5'
export const AI_COACH_ANTHROPIC_BASE_URL = 'https://api.anthropic.com'

/**
 * 常见的 OpenAI 兼容服务地址，只用来一键填入「接口地址」。模型名由用户自己填写，
 * 以服务商当前的文档为准：这里不替任何服务商维护模型清单。
 */
export const AI_COACH_OPENAI_PRESETS = [
  { id: 'deepseek', baseUrl: 'https://api.deepseek.com' },
  { id: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'ollama', baseUrl: 'http://localhost:11434/v1' }
] as const

/** 回答的最大长度（含模型的思考）。复盘正文只有几百到一两千字，留足余量。 */
export const AI_COACH_MAX_OUTPUT_TOKENS = 16_000
/** 一次对话最多带的消息条数与总字数，超过就拒绝，免得无意中发出巨大的请求。 */
export const AI_COACH_MAX_MESSAGES = 40
export const AI_COACH_MAX_REQUEST_CHARS = 400_000
export const AI_COACH_MAX_KEY_LENGTH = 500

export interface AiCoachMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiCoachChatRequest {
  /** Chosen by the caller; identifies the stream for deltas and for cancelling. */
  requestId: string
  system: string
  messages: AiCoachMessage[]
}

export type AiCoachErrorCode =
  /** Provider, model or address not filled in. */
  | 'not-configured'
  | 'no-key'
  | 'invalid-request'
  /** Another answer is still being written. */
  | 'busy'
  | 'auth'
  | 'permission'
  | 'billing'
  /** Usually a wrong model name or a wrong address. */
  | 'not-found'
  | 'rate-limit'
  | 'too-large'
  | 'bad-request'
  | 'server'
  | 'network'
  | 'timeout'
  | 'cancelled'
  /** The provider declined to answer. */
  | 'refused'
  /** The provider answered with nothing. */
  | 'empty'
  | 'unknown'

export interface AiCoachUsage {
  inputTokens: number | null
  outputTokens: number | null
  /** Input tokens served from the provider's prompt cache. */
  cachedInputTokens: number | null
}

export type AiCoachChatResult =
  | {
      result: 'ok'
      text: string
      /** The answer hit the length limit and stops mid-way. */
      truncated: boolean
      usage: AiCoachUsage
      /** Model name as the provider reports it. */
      model: string
    }
  | {
      result: 'failed'
      code: AiCoachErrorCode
      /** The provider's own short description, when it gave one. Never contains the key. */
      message: string
      /** Whatever had been written before the failure. */
      text: string
    }

export interface AiCoachDeltaEvent {
  requestId: string
  text: string
}

export type AiCoachKeyResult =
  | {
      result: 'ok'
      /** false when the system offers no encryption: the key then lives until the app closes. */
      persisted: boolean
    }
  | { result: 'failed'; reason: 'invalid-key' | 'invalid-provider' | 'write-failed' }

const isProvider = (value: unknown): value is AiCoachProvider =>
  AI_COACH_PROVIDERS.includes(value as AiCoachProvider)

export function isAiCoachProvider(value: unknown): value is AiCoachProvider {
  return isProvider(value)
}

/** A key as typed or pasted: surrounding blanks removed; null when it cannot be a key. */
export function normalizeAiCoachKey(value: unknown) {
  if (typeof value !== 'string') return null
  const key = value.trim()
  // 密钥是一串可见字符；中间带空白、控制字符或非 ASCII 字符的多半是粘贴错了。
  return key.length >= 8 && key.length <= AI_COACH_MAX_KEY_LENGTH && /^[\x21-\x7e]+$/.test(key)
    ? key
    : null
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * A service address as typed, cleaned up. https is required because the key travels in the
 * request; plain http is accepted only for a model server on this computer.
 */
export function normalizeAiCoachBaseUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.username || url.password) return null
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)))
    return null
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/+$/, '')
}

/** The chat endpoint of an OpenAI-compatible service; the address may already point at it. */
export function resolveOpenAiChatUrl(baseUrl: unknown) {
  const normalized = normalizeAiCoachBaseUrl(baseUrl)
  if (!normalized) return null
  return /\/chat\/completions$/.test(normalized) ? normalized : `${normalized}/chat/completions`
}

/** Checks a request before anything is sent; null when it is fine. */
export function validateAiCoachRequest(request: unknown): string | null {
  const value = request as Partial<AiCoachChatRequest> | null
  if (!value || typeof value !== 'object') return 'request is not an object'
  if (typeof value.requestId !== 'string' || !/^[\w-]{1,80}$/.test(value.requestId))
    return 'requestId is invalid'
  if (typeof value.system !== 'string') return 'system prompt is missing'
  if (!Array.isArray(value.messages) || !value.messages.length) return 'messages are missing'
  if (value.messages.length > AI_COACH_MAX_MESSAGES) return 'too many messages'
  let total = value.system.length
  for (const [index, message] of value.messages.entries()) {
    if (
      !message ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string' ||
      !message.content.trim()
    )
      return `message ${index} is invalid`
    // 两家接口都要求用户与助手交替、由用户开头并由用户结尾。
    if (message.role !== (index % 2 === 0 ? 'user' : 'assistant'))
      return `message ${index} breaks the user/assistant order`
    total += message.content.length
  }
  if (value.messages.length % 2 === 0) return 'the last message must come from the user'
  if (total > AI_COACH_MAX_REQUEST_CHARS) return 'request is too large'
  return null
}

/**
 * Splits a server-sent-event stream into the `data` payload of each event. Chunks may cut
 * anywhere, so the parser keeps the unfinished tail between calls.
 */
export function createSseDataParser(onData: (data: string) => void) {
  let buffer = ''
  let lines: string[] = []
  const dispatch = () => {
    if (lines.length) onData(lines.join('\n'))
    lines = []
  }
  const take = (line: string) => {
    if (line === '') dispatch()
    else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''))
    // 其它字段（event、id、retry）和以冒号开头的注释在这里用不到。
  }
  return {
    push(chunk: string) {
      buffer += chunk
      for (;;) {
        const match = /\r\n|\n|\r/.exec(buffer)
        // 末尾单独的回车可能是被切开的回车换行，等下一块再判断。
        if (!match || (match[0] === '\r' && match.index === buffer.length - 1)) break
        take(buffer.slice(0, match.index))
        buffer = buffer.slice(match.index + match[0].length)
      }
    },
    /** Call when the stream ends: an event without its closing blank line still counts. */
    flush() {
      if (buffer) take(buffer.replace(/\r$/, ''))
      buffer = ''
      dispatch()
    }
  }
}

export interface OpenAiStreamChunk {
  done: boolean
  text: string
  finishReason: string | null
  usage: AiCoachUsage | null
  /** An error object some services send in place of a chunk. */
  error: string | null
}

const tokenCount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

/** Reads the usage block of an OpenAI-style response; null when there is none. */
export function readOpenAiUsage(value: unknown): AiCoachUsage | null {
  if (!value || typeof value !== 'object') return null
  const usage = value as Record<string, unknown>
  const details = usage.prompt_tokens_details as Record<string, unknown> | null | undefined
  const result = {
    inputTokens: tokenCount(usage.prompt_tokens),
    outputTokens: tokenCount(usage.completion_tokens),
    cachedInputTokens: tokenCount(details?.cached_tokens ?? usage.prompt_cache_hit_tokens)
  }
  return result.inputTokens === null && result.outputTokens === null ? null : result
}

/** Reads one `data` payload of an OpenAI-style stream; null when it is not understood. */
export function readOpenAiStreamChunk(data: string): OpenAiStreamChunk | null {
  const empty = { done: false, text: '', finishReason: null, usage: null, error: null }
  if (data.trim() === '[DONE]') return { ...empty, done: true }
  let value: Record<string, unknown>
  try {
    value = JSON.parse(data)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const failure = value.error as { message?: unknown } | string | null | undefined
  if (failure) {
    const message = typeof failure === 'string' ? failure : failure.message
    return { ...empty, error: typeof message === 'string' && message ? message : 'error' }
  }
  const choice = (Array.isArray(value.choices) ? value.choices[0] : null) as {
    delta?: { content?: unknown }
    finish_reason?: unknown
  } | null
  const content = choice?.delta?.content
  return {
    ...empty,
    text: typeof content === 'string' ? content : '',
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    usage: readOpenAiUsage(value.usage)
  }
}

/** Removes the key from a text that is about to be shown or logged. */
export function redactAiCoachSecret(text: string, secret: string) {
  return secret ? text.split(secret).join('***') : text
}
