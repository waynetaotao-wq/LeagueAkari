import {
  AI_COACH_ANTHROPIC_BASE_URL,
  type AiCoachChatRequest,
  type AiCoachChatResult,
  type AiCoachErrorCode,
  type AiCoachProvider,
  normalizeAiCoachBaseUrl,
  validateAiCoachRequest
} from '@shared/shards/ai-coach'

import {
  AI_COACH_CONNECT_TIMEOUT_MS,
  AI_COACH_DELTA_FLUSH_MS,
  AI_COACH_REQUEST_TIMEOUT_MS,
  type AiCoachExecutor,
  type AiCoachFetch,
  type AiCoachMainContext
} from './context'
import type { AiCoachCredentialLoader } from './credential-loader'

const failed = (code: AiCoachErrorCode, message = ''): AiCoachChatResult => ({
  result: 'failed',
  code,
  message,
  text: ''
})

export type AiCoachChatContext = Pick<AiCoachMainContext, 'logger' | 'settings'>

/**
 * Runs one conversation at a time: checks the request, picks the provider the user chose,
 * hands the answer back piece by piece, and ends it on cancel or when it takes too long.
 */
export class AiCoachChatController {
  private _active: { requestId: string; controller: AbortController } | null = null

  constructor(
    private readonly _context: AiCoachChatContext,
    private readonly _credentialLoader: Pick<AiCoachCredentialLoader, 'get'>,
    private readonly _executors: Record<AiCoachProvider, AiCoachExecutor>,
    private readonly _fetch: AiCoachFetch
  ) {}

  dispose() {
    this._active?.controller.abort()
    this._active = null
  }

  /**
   * Stops the answer being written. Without an id it stops whichever one is running, which a
   * freshly loaded window uses to end a request its previous page left behind.
   *
   * @returns whether an answer was stopped
   */
  cancel(requestId?: unknown) {
    if (!this._active) {
      return false
    }
    if (requestId !== undefined && requestId !== null && this._active.requestId !== requestId) {
      return false
    }

    this._active.controller.abort()
    return true
  }

  async chat(
    request: AiCoachChatRequest,
    onDelta: (text: string) => void
  ): Promise<AiCoachChatResult> {
    const { logger, settings } = this._context
    const problem = validateAiCoachRequest(request)
    if (problem) {
      return failed('invalid-request', problem)
    }
    if (this._active) {
      return failed('busy')
    }

    const provider = settings.provider
    const model = (provider === 'anthropic' ? settings.anthropicModel : settings.openaiModel).trim()
    const baseUrl =
      provider === 'anthropic'
        ? settings.anthropicBaseUrl.trim()
          ? normalizeAiCoachBaseUrl(settings.anthropicBaseUrl)
          : AI_COACH_ANTHROPIC_BASE_URL
        : normalizeAiCoachBaseUrl(settings.openaiBaseUrl)
    if (!model || !baseUrl) {
      return failed('not-configured')
    }

    const apiKey = this._credentialLoader.get(provider)
    if (!apiKey) {
      return failed('no-key')
    }

    const controller = new AbortController()
    this._active = { requestId: request.requestId, controller }

    let timedOut = false
    const expire = () => {
      timedOut = true
      controller.abort()
    }
    const totalTimer = setTimeout(expire, AI_COACH_REQUEST_TIMEOUT_MS)
    // 每次连接（含自动重试的那几次）都单独限时：服务迟迟不回应就不再等。
    const connectTimers = new Set<NodeJS.Timeout>()
    const fetchWithConnectTimeout: AiCoachFetch = async (input, init) => {
      const timer = setTimeout(expire, AI_COACH_CONNECT_TIMEOUT_MS)
      connectTimers.add(timer)
      try {
        return await this._fetch(input, init)
      } finally {
        clearTimeout(timer)
        connectTimers.delete(timer)
      }
    }

    // 片段攒一小会儿再发，界面不用逐字处理。
    let pending = ''
    let flushTimer: NodeJS.Timeout | null = null
    const flush = () => {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (pending) {
        const text = pending
        pending = ''
        onDelta(text)
      }
    }

    const startedAt = Date.now()
    logger.info(
      `Chat started: provider=${provider} model=${model} messages=${request.messages.length}`
    )
    try {
      let result = await this._executors[provider]({
        apiKey,
        model,
        baseUrl,
        system: request.system,
        messages: request.messages,
        signal: controller.signal,
        fetch: fetchWithConnectTimeout,
        onDelta: (text) => {
          pending += text
          flushTimer ??= setTimeout(flush, AI_COACH_DELTA_FLUSH_MS)
        }
      })
      flush()

      if (result.result === 'failed' && result.code === 'cancelled' && timedOut) {
        result = { ...result, code: 'timeout' }
      }

      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
      if (result.result === 'ok') {
        logger.info(
          `Chat finished in ${seconds}s: input=${result.usage.inputTokens ?? '?'} cached=${
            result.usage.cachedInputTokens ?? '?'
          } output=${result.usage.outputTokens ?? '?'} truncated=${result.truncated}`
        )
      } else if (result.code === 'cancelled') {
        logger.info(`Chat stopped after ${seconds}s`)
      } else {
        // 只记错误类别：服务商返回的原文可能带着请求里的内容。
        logger.warn(`Chat failed after ${seconds}s: ${result.code}`)
      }
      return result
    } catch (error) {
      flush()
      logger.warn(`Chat failed unexpectedly: ${error instanceof Error ? error.name : 'error'}`)
      return failed('unknown')
    } finally {
      clearTimeout(totalTimer)
      connectTimers.forEach((timer) => clearTimeout(timer))
      if (this._active?.controller === controller) {
        this._active = null
      }
    }
  }
}
