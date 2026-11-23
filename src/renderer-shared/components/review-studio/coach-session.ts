import {
  AI_COACH_MAX_MESSAGES,
  type AiCoachChatRequest,
  type AiCoachChatResult,
  type AiCoachErrorCode,
  type AiCoachMessage,
  type AiCoachUsage
} from '@shared/shards/ai-coach'
import { reactive, ref } from 'vue'

import {
  REVIEW_COACH_MAX_QUESTION_LENGTH,
  REVIEW_COACH_PROMPT_VERSION,
  normalizeReviewCoachText
} from './coach-prompt'
import {
  REVIEW_STORAGE_NAMESPACE,
  type ReviewArchiveScope,
  type ReviewStorageAdapter,
  reviewScopeKey
} from './notes'

// [lolps] AI 教练的对话管理。
// 对话不放在界面组件里：回答可能要写一两分钟，这期间玩家会切到时间线去看教练提到的时刻，
// 甚至关掉复盘台。对话在这里继续，回来还在；写完的对话存进本机，下次打开同一局接着问。
// 发出去的第一条消息（整份对局资料）原样保存、原样重发：这样追问时服务端能复用缓存，
// 也保证教练后面看到的资料和第一次回答时是同一份。

/** 每个账号最多留这么多局的对话，超出时丢掉最久没动过的。 */
export const REVIEW_COACH_MAX_SAVED_CONVERSATIONS = 20

export interface ReviewCoachTransport {
  chat(request: AiCoachChatRequest, onDelta: (text: string) => void): Promise<AiCoachChatResult>
  cancel(requestId: string): unknown
}

export interface ReviewCoachTarget {
  /** Whose archive the conversation is kept in; null keeps it in memory only. */
  scope: ReviewArchiveScope | null
  sgpServerId: string
  gameId: number
}

export interface ReviewCoachConversation {
  /** false until a saved conversation, if there is one, has been read. */
  loaded: boolean
  system: string
  /** Turns in order, starting with the game document. Ends with the user while unanswered. */
  messages: AiCoachMessage[]
  streaming: boolean
  /** The answer as far as it has been written; after a failure, what had arrived before it. */
  pendingText: string
  /** Why the last request produced no answer. */
  error: { code: AiCoachErrorCode; message: string } | null
  /** The last answer stops early: it hit the length limit, or the player stopped it. */
  incomplete: 'length' | 'stopped' | null
  usage: AiCoachUsage | null
  model: string | null
  updatedAt: number | null
  /** The conversation could not be written to this device; it lives until the app closes. */
  saveFailed: boolean
}

interface StoredConversation {
  gameId: number
  promptVersion: number
  system: string
  messages: AiCoachMessage[]
  incomplete: 'length' | 'stopped' | null
  usage: AiCoachUsage | null
  model: string | null
  updatedAt: number
}

interface Entry {
  key: string
  scopeKey: string | null
  gameId: number
  state: ReviewCoachConversation
  requestId: string | null
  inflight: Promise<void> | null
}

const emptyConversation = (): ReviewCoachConversation => ({
  loaded: false,
  system: '',
  messages: [],
  streaming: false,
  pendingText: '',
  error: null,
  incomplete: null,
  usage: null,
  model: null,
  updatedAt: null,
  saveFailed: false
})

const tokenCount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

function readUsage(value: unknown): AiCoachUsage | null {
  if (!value || typeof value !== 'object') return null
  const usage = value as Record<string, unknown>
  return {
    inputTokens: tokenCount(usage.inputTokens),
    outputTokens: tokenCount(usage.outputTokens),
    cachedInputTokens: tokenCount(usage.cachedInputTokens)
  }
}

/** A saved conversation is used only when it is a complete, well-formed exchange. */
function readStoredConversation(value: unknown): StoredConversation | null {
  if (!value || typeof value !== 'object') return null
  const stored = value as Record<string, unknown>
  const messages = stored.messages
  if (
    !Number.isSafeInteger(stored.gameId) ||
    typeof stored.system !== 'string' ||
    typeof stored.updatedAt !== 'number' ||
    !Number.isFinite(stored.updatedAt) ||
    !Array.isArray(messages) ||
    messages.length < 2 ||
    messages.length % 2 !== 0 ||
    messages.length > AI_COACH_MAX_MESSAGES
  )
    return null

  const turns: AiCoachMessage[] = []
  for (const [index, message] of messages.entries()) {
    const role = index % 2 === 0 ? 'user' : 'assistant'
    if (
      !message ||
      typeof message !== 'object' ||
      message.role !== role ||
      typeof message.content !== 'string' ||
      !message.content.trim()
    )
      return null
    turns.push({ role, content: message.content })
  }

  return {
    gameId: stored.gameId as number,
    promptVersion: typeof stored.promptVersion === 'number' ? stored.promptVersion : 0,
    system: stored.system,
    messages: turns,
    incomplete:
      stored.incomplete === 'length' || stored.incomplete === 'stopped' ? stored.incomplete : null,
    usage: readUsage(stored.usage),
    model: typeof stored.model === 'string' ? stored.model : null,
    updatedAt: stored.updatedAt
  }
}

export function reviewCoachStorageKey(scope: ReviewArchiveScope) {
  return `coach:${reviewScopeKey(scope)}`
}

/** Whether another question still fits into the conversation. */
export function canAskReviewCoach(conversation: Pick<ReviewCoachConversation, 'messages'>) {
  const { messages } = conversation
  return (
    messages.length >= 2 &&
    // 末尾是没答上的提问时，新问题会替换它，不占新的位置。
    (messages.at(-1)!.role === 'user' || messages.length + 1 <= AI_COACH_MAX_MESSAGES)
  )
}

export class ReviewCoachSessionController {
  /** Key of the conversation whose answer is being written; the provider handles one at a time. */
  readonly activeKey = ref<string | null>(null)

  private readonly _entries = new Map<string, Entry>()
  private readonly _records = new Map<string, Promise<StoredConversation[]>>()
  private readonly _writes = new Map<string, Promise<void>>()
  private _sequence = 0

  constructor(
    private readonly _transport: ReviewCoachTransport,
    private readonly _storage: ReviewStorageAdapter,
    private readonly _now: () => number = () => Date.now()
  ) {}

  keyOf(target: ReviewCoachTarget) {
    return target.scope
      ? `${reviewScopeKey(target.scope)}|${target.gameId}`
      : `unsaved|${target.sgpServerId}|${target.gameId}`
  }

  /** The conversation about one game. The same reactive object is returned every time. */
  open(target: ReviewCoachTarget): ReviewCoachConversation {
    const entry = this._entry(target)
    if (!entry.state.loaded && !entry.inflight) void this._load(entry)
    return entry.state
  }

  /** Begins a new conversation about the game, replacing the one shown. */
  async start(target: ReviewCoachTarget, input: { system: string; firstMessage: string }) {
    const entry = this._entry(target)
    const { state } = entry
    if (state.streaming || !input.firstMessage.trim()) return

    state.system = input.system
    state.messages = [{ role: 'user', content: input.firstMessage }]
    state.usage = null
    state.model = null
    state.updatedAt = null
    await this._send(entry)
  }

  async ask(target: ReviewCoachTarget, question: unknown) {
    const entry = this._entry(target)
    const { state } = entry
    const text = normalizeReviewCoachText(question, REVIEW_COACH_MAX_QUESTION_LENGTH)
    if (!text || state.streaming || !canAskReviewCoach(state)) return

    if (state.messages.at(-1)!.role === 'user') {
      state.messages[state.messages.length - 1] = { role: 'user', content: text }
    } else {
      state.messages.push({ role: 'user', content: text })
    }
    await this._send(entry)
  }

  /** Sends the unanswered question again. */
  async retry(target: ReviewCoachTarget) {
    const entry = this._entry(target)
    const { state } = entry
    if (state.streaming || state.messages.at(-1)?.role !== 'user') return
    await this._send(entry)
  }

  stop(target: ReviewCoachTarget) {
    const entry = this._entries.get(this.keyOf(target))
    if (entry?.requestId) {
      void Promise.resolve(this._transport.cancel(entry.requestId)).catch(() => {})
    }
  }

  /** Goes back to what is saved for this game: the last finished exchange, or nothing. */
  async restore(target: ReviewCoachTarget) {
    const entry = this._entry(target)
    await this._settle(entry)
    Object.assign(entry.state, emptyConversation())
    await this._load(entry)
  }

  /** Forgets the conversation about this game, on this device too. */
  async reset(target: ReviewCoachTarget) {
    const entry = this._entry(target)
    await this._settle(entry)
    Object.assign(entry.state, emptyConversation(), { loaded: true })
    if (entry.scopeKey) {
      const saved = await this._write(entry.scopeKey, (records) =>
        records.filter((record) => record.gameId !== entry.gameId)
      )
      entry.state.saveFailed = !saved
    }
  }

  private _entry(target: ReviewCoachTarget) {
    const key = this.keyOf(target)
    let entry = this._entries.get(key)
    if (!entry) {
      entry = {
        key,
        scopeKey: target.scope ? reviewCoachStorageKey(target.scope) : null,
        gameId: target.gameId,
        state: reactive(emptyConversation()),
        requestId: null,
        inflight: null
      }
      this._entries.set(key, entry)
    }
    return entry
  }

  /** Stops an answer that is being written and waits until the provider has let go of it. */
  private async _settle(entry: Entry) {
    if (entry.requestId) {
      void Promise.resolve(this._transport.cancel(entry.requestId)).catch(() => {})
    }
    await entry.inflight
  }

  private _readRecords(scopeKey: string) {
    let records = this._records.get(scopeKey)
    if (!records) {
      records = Promise.resolve(this._storage.get(REVIEW_STORAGE_NAMESPACE, scopeKey, null))
        .then((stored) => {
          const value = stored as { version?: unknown; conversations?: unknown } | null
          if (!value || value.version !== 1 || !Array.isArray(value.conversations)) return []
          return value.conversations.flatMap((item) => {
            const conversation = readStoredConversation(item)
            return conversation ? [conversation] : []
          })
        })
        // 读不出来就当没有：对话仍然可以开始，只是看不到之前的。
        .catch(() => [])
      this._records.set(scopeKey, records)
    }
    return records
  }

  private async _load(entry: Entry) {
    const stored = entry.scopeKey
      ? (await this._readRecords(entry.scopeKey)).find((record) => record.gameId === entry.gameId)
      : undefined
    const { state } = entry
    // 读取期间玩家可能已经开始了新的对话，那就以新的为准。
    if (stored && !state.messages.length && !state.streaming) {
      state.system = stored.system
      state.messages = stored.messages.map((message) => ({ ...message }))
      state.incomplete = stored.incomplete
      state.usage = stored.usage
      state.model = stored.model
      state.updatedAt = stored.updatedAt
    }
    state.loaded = true
  }

  /** One change at a time per account, applied to the latest list. Resolves false on failure. */
  private _write(
    scopeKey: string,
    change: (records: StoredConversation[]) => StoredConversation[]
  ): Promise<boolean> {
    const previous = this._writes.get(scopeKey) ?? Promise.resolve()
    const task = previous.then(async () => {
      const records = change(await this._readRecords(scopeKey))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, REVIEW_COACH_MAX_SAVED_CONVERSATIONS)
      await this._storage.set(REVIEW_STORAGE_NAMESPACE, scopeKey, {
        version: 1,
        conversations: records
      })
      this._records.set(scopeKey, Promise.resolve(records))
    })
    const settled = task.then(
      () => true,
      () => false
    )
    this._writes.set(
      scopeKey,
      settled.then(() => {})
    )
    return settled
  }

  private async _persist(entry: Entry) {
    const { state, scopeKey, gameId } = entry
    if (!scopeKey) return

    const record: StoredConversation = {
      gameId,
      promptVersion: REVIEW_COACH_PROMPT_VERSION,
      system: state.system,
      messages: state.messages.map(({ role, content }) => ({ role, content })),
      incomplete: state.incomplete,
      usage: state.usage ? { ...state.usage } : null,
      model: state.model,
      updatedAt: state.updatedAt ?? this._now()
    }
    const saved = await this._write(scopeKey, (records) => [
      record,
      ...records.filter((item) => item.gameId !== gameId)
    ])
    state.saveFailed = !saved
  }

  private _send(entry: Entry) {
    const { state } = entry
    if (this.activeKey.value !== null) {
      // 另一局的回答还在写：同一时间只发一个请求。
      state.error = { code: 'busy', message: '' }
      return Promise.resolve()
    }

    const requestId = `coach-${this._now().toString(36)}-${++this._sequence}`
    entry.requestId = requestId
    this.activeKey.value = entry.key
    state.loaded = true
    state.streaming = true
    state.pendingText = ''
    state.error = null
    state.incomplete = null

    const task = (async () => {
      let result: AiCoachChatResult
      try {
        result = await this._transport.chat(
          {
            requestId,
            system: state.system,
            // 复制成普通对象：响应式代理不能跨进程传递。
            messages: state.messages.map(({ role, content }) => ({ role, content }))
          },
          (text) => {
            if (entry.requestId === requestId) state.pendingText += text
          }
        )
      } catch {
        result = { result: 'failed', code: 'unknown', message: '', text: state.pendingText }
      }

      entry.requestId = null
      state.streaming = false
      this.activeKey.value = null

      if (result.result === 'ok') {
        state.messages.push({ role: 'assistant', content: result.text })
        state.pendingText = ''
        state.incomplete = result.truncated ? 'length' : null
        state.usage = result.usage
        state.model = result.model
        state.updatedAt = this._now()
        await this._persist(entry)
      } else if (result.code === 'cancelled' && result.text.trim()) {
        // 玩家看了一部分后自己停下：已经写出来的就是这次的回答。
        state.messages.push({ role: 'assistant', content: result.text })
        state.pendingText = ''
        state.incomplete = 'stopped'
        state.updatedAt = this._now()
        await this._persist(entry)
      } else {
        state.pendingText = result.text
        state.error = { code: result.code, message: result.message }
      }
    })()

    entry.inflight = task.finally(() => {
      if (entry.inflight === tracked) entry.inflight = null
    })
    const tracked = entry.inflight
    return tracked
  }
}
