import {
  AI_COACH_MAX_OUTPUT_TOKENS,
  type AiCoachChatResult,
  type AiCoachErrorCode,
  redactAiCoachSecret
} from '@shared/shards/ai-coach'

import {
  AI_COACH_MAX_ERROR_MESSAGE_LENGTH,
  AI_COACH_REQUEST_TIMEOUT_MS,
  type AiCoachExecuteInput
} from './context'

// SDK 只在第一次发问时加载：不用 AI 教练的人不为它多等启动时间，
// 它万一加载不了也只影响这一个功能。
const importSdk = () => import('@anthropic-ai/sdk')
type AnthropicSdk = Awaited<ReturnType<typeof importSdk>>['default']
let sdk: Promise<AnthropicSdk> | null = null
const loadSdk = () => (sdk ??= importSdk().then((module) => module.default))

/** An error reported inside the stream has no HTTP status; its type says what happened. */
const CODE_BY_ERROR_TYPE: Partial<Record<string, AiCoachErrorCode>> = {
  invalid_request_error: 'bad-request',
  authentication_error: 'auth',
  billing_error: 'billing',
  permission_error: 'permission',
  not_found_error: 'not-found',
  rate_limit_error: 'rate-limit',
  timeout_error: 'timeout',
  api_error: 'server',
  overloaded_error: 'server'
}

/** Most specific class first: a connection error is also an APIError in this SDK. */
function classify(
  Anthropic: AnthropicSdk | null,
  error: unknown,
  signal: AbortSignal
): AiCoachErrorCode {
  if (signal.aborted) return 'cancelled'
  if (!Anthropic) return 'unknown'
  if (error instanceof Anthropic.APIUserAbortError) return 'cancelled'
  if (error instanceof Anthropic.AuthenticationError) return 'auth'
  if (error instanceof Anthropic.PermissionDeniedError) return 'permission'
  if (error instanceof Anthropic.PaymentRequiredError) return 'billing'
  if (error instanceof Anthropic.NotFoundError) return 'not-found'
  if (error instanceof Anthropic.RateLimitError) return 'rate-limit'
  if (error instanceof Anthropic.ContentTooLargeError) return 'too-large'
  if (error instanceof Anthropic.RequestTimeoutError) return 'timeout'
  if (error instanceof Anthropic.BadRequestError) return 'bad-request'
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'timeout'
  if (error instanceof Anthropic.APIConnectionError) return 'network'
  if (error instanceof Anthropic.InternalServerError) return 'server'
  if (error instanceof Anthropic.APIError) {
    const code = error.type ? CODE_BY_ERROR_TYPE[error.type] : undefined
    if (code) return code
    if (typeof error.status === 'number') return error.status >= 500 ? 'server' : 'bad-request'
  }
  return 'unknown'
}

/** The service's own short explanation, without the status line and raw body around it. */
function describe(Anthropic: AnthropicSdk | null, error: unknown) {
  if (Anthropic && error instanceof Anthropic.APIError && error.apiMessage) {
    return error.apiMessage
  }
  if (!(error instanceof Error)) {
    return String(error)
  }

  // 连接类错误的原因在 cause 里（如代理连不上、域名解析失败）。
  const cause = error.cause instanceof Error ? error.cause.message : ''
  return cause && !error.message.includes(cause) ? `${error.message} ${cause}` : error.message
}

/**
 * Sends one conversation to the Claude API through the official SDK and streams the answer.
 * Thinking is left to the model's default (adaptive on current models) and no sampling
 * parameter is sent, so the same request is valid for every current Claude model.
 */
export async function executeAnthropicChat(input: AiCoachExecuteInput): Promise<AiCoachChatResult> {
  let text = ''
  let Anthropic: AnthropicSdk | null = null
  try {
    Anthropic = await loadSdk()
    const client = new Anthropic({
      apiKey: input.apiKey,
      // 明确给出地址和认证方式，不让环境变量里的配置混进来。
      authToken: null,
      baseURL: input.baseUrl,
      fetch: input.fetch,
      // 这里的超时只管到服务开始回应为止；整次请求的时限由调用方通过 signal 控制。
      timeout: AI_COACH_REQUEST_TIMEOUT_MS
    })

    // 第一条消息是整份对局资料，追问时原样重发：在它末尾设缓存点，追问更快也更省。
    const [first, ...rest] = input.messages
    const stream = client.messages.stream(
      {
        model: input.model,
        max_tokens: AI_COACH_MAX_OUTPUT_TOKENS,
        ...(input.system.trim() && { system: input.system }),
        messages: [
          {
            role: first.role,
            content: [{ type: 'text', text: first.content, cache_control: { type: 'ephemeral' } }]
          },
          ...rest
        ]
      },
      { signal: input.signal }
    )
    stream.on('text', (delta) => {
      text += delta
      input.onDelta(delta)
    })

    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') {
      return { result: 'failed', code: 'refused', message: '', text }
    }
    if (!text.trim()) {
      return { result: 'failed', code: 'empty', message: '', text: '' }
    }
    return {
      result: 'ok',
      text,
      truncated:
        message.stop_reason === 'max_tokens' ||
        message.stop_reason === 'model_context_window_exceeded',
      usage: {
        // 接口把读缓存、写缓存和其余输入分开计数；这里合成「一共读了多少」。
        inputTokens:
          message.usage.input_tokens +
          (message.usage.cache_read_input_tokens ?? 0) +
          (message.usage.cache_creation_input_tokens ?? 0),
        outputTokens: message.usage.output_tokens,
        cachedInputTokens: message.usage.cache_read_input_tokens ?? null
      },
      model: message.model
    }
  } catch (error) {
    return {
      result: 'failed',
      code: classify(Anthropic, error, input.signal),
      message: redactAiCoachSecret(describe(Anthropic, error), input.apiKey).slice(
        0,
        AI_COACH_MAX_ERROR_MESSAGE_LENGTH
      ),
      text
    }
  }
}
