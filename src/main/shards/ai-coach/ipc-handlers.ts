import type { AiCoachChatRequest, AiCoachDeltaEvent } from '@shared/shards/ai-coach'

import type { AiCoachChatController } from './chat-controller'
import type { AiCoachMainContext } from './context'
import type { AiCoachCredentialLoader } from './credential-loader'

export class AiCoachIpcHandlers {
  constructor(
    private readonly _context: AiCoachMainContext,
    private readonly _chatController: AiCoachChatController,
    private readonly _credentialLoader: AiCoachCredentialLoader
  ) {}

  register() {
    const { ipc, namespace, state } = this._context

    // 回答的片段只发回发起请求的那个窗口。
    ipc.onCall(namespace, 'chat', (event, request: AiCoachChatRequest) => {
      return this._chatController.chat(request, (text) => {
        if (event.sender.isDestroyed()) {
          // 窗口没了就没人看了，别让请求白跑。
          this._chatController.cancel(request.requestId)
          return
        }

        const delta: AiCoachDeltaEvent = { requestId: request.requestId, text }
        ipc.sendEventToWebContents(event.sender, namespace, 'chat-delta', delta)
      })
    })

    // 不带编号 = 停掉正在写的那一个（窗口重新加载后用来收尾）。
    ipc.onCall(namespace, 'cancelChat', (_, requestId?: string) => {
      return this._chatController.cancel(requestId)
    })

    // 密钥只在这一次调用里从界面传进来，之后界面再也拿不到它。
    ipc.onCall(namespace, 'setApiKey', async (_, provider: unknown, key: unknown) => {
      const result = await this._credentialLoader.set(provider, key)
      this._syncKeyState()
      return result
    })

    ipc.onCall(namespace, 'clearApiKey', async (_, provider: unknown) => {
      const cleared = await this._credentialLoader.clear(provider)
      this._syncKeyState()
      return cleared
    })

    state.setCanPersistKeys(this._credentialLoader.canPersist)
    this._syncKeyState()
  }

  private _syncKeyState() {
    const { state } = this._context
    state.setHasKey('anthropic', this._credentialLoader.has('anthropic'))
    state.setHasKey('openai-compatible', this._credentialLoader.has('openai-compatible'))
  }
}
