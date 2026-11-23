import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import {
  AI_COACH_PROVIDERS,
  type AiCoachProvider,
  normalizeAiCoachBaseUrl
} from '@shared/shards/ai-coach'
import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'

import { AkariIpcMain } from '../ipc'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { NetworkMain } from '../network'
import { SettingFactoryMain } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'
import { executeAnthropicChat } from './anthropic-executor'
import { AiCoachChatController } from './chat-controller'
import {
  AI_COACH_CREDENTIAL_FILE,
  AI_COACH_MAIN_NAMESPACE,
  type AiCoachMainContext
} from './context'
import { AiCoachCredentialLoader } from './credential-loader'
import { AiCoachIpcHandlers } from './ipc-handlers'
import { executeOpenAiCompatibleChat } from './openai-compatible-executor'
import { AiCoachSettings, AiCoachState } from './state'

const modelSchema = z.string().max(200)
// 转换发生在类型校验之前，传进来的不一定是文字：不是文字的原样交给校验去拒绝。
const trimSetting = ({ value }: { value: string }) =>
  typeof value === 'string' ? value.trim() : value
/** 地址写错时存成空，界面会提示还没填好，而不是带着错误的地址去请求。 */
const normalizeUrlSetting = ({ value }: { value: string }) =>
  typeof value === 'string' ? (normalizeAiCoachBaseUrl(value) ?? '') : value

/**
 * [lolps] AI 教练（见 context.ts 说明）
 */
@Shard(AiCoachMain.id)
export class AiCoachMain implements IAkariShardInitDispose {
  static id = AI_COACH_MAIN_NAMESPACE

  public readonly settings = new AiCoachSettings()
  public readonly state = new AiCoachState()

  private readonly _logger: AkariLogger
  private readonly _settingService: SetterSettingService<AiCoachSettings>
  private readonly _context: AiCoachMainContext
  private readonly _credentialLoader: AiCoachCredentialLoader
  private readonly _chatController: AiCoachChatController
  private readonly _ipcHandlers: AiCoachIpcHandlers

  constructor(
    private readonly _ipc: AkariIpcMain,
    _loggerFactory: LoggerFactoryMain,
    private readonly _mobxUtils: MobxUtilsMain,
    private readonly _network: NetworkMain,
    _settingFactory: SettingFactoryMain
  ) {
    this._logger = _loggerFactory.create(AiCoachMain.id)
    this._settingService = _settingFactory.register(
      AiCoachMain.id,
      {
        provider: {
          default: this.settings.provider,
          schema: z.enum(AI_COACH_PROVIDERS) as z.ZodType<AiCoachProvider>
        },
        anthropicModel: {
          default: this.settings.anthropicModel,
          schema: modelSchema,
          transform: trimSetting
        },
        anthropicBaseUrl: {
          default: this.settings.anthropicBaseUrl,
          schema: z.string().max(500),
          transform: normalizeUrlSetting
        },
        openaiBaseUrl: {
          default: this.settings.openaiBaseUrl,
          schema: z.string().max(500),
          transform: normalizeUrlSetting
        },
        openaiModel: {
          default: this.settings.openaiModel,
          schema: modelSchema,
          transform: trimSetting
        }
      },
      this.settings
    )

    this._context = {
      namespace: AiCoachMain.id,
      logger: this._logger,
      ipc: this._ipc,
      mobxUtils: this._mobxUtils,
      settings: this.settings,
      state: this.state
    }
    this._credentialLoader = new AiCoachCredentialLoader(
      join(app.getPath('userData'), AI_COACH_CREDENTIAL_FILE),
      safeStorage,
      this._logger
    )
    this._chatController = new AiCoachChatController(
      this._context,
      this._credentialLoader,
      { anthropic: executeAnthropicChat, 'openai-compatible': executeOpenAiCompatibleChat },
      (input, init) => this._network.fetch(input, init)
    )
    this._ipcHandlers = new AiCoachIpcHandlers(
      this._context,
      this._chatController,
      this._credentialLoader
    )
  }

  async onInit() {
    await this._settingService.applyToState()
    await this._credentialLoader.load()

    this._mobxUtils.propSync(AiCoachMain.id, 'settings', this.settings, [
      'provider',
      'anthropicModel',
      'anthropicBaseUrl',
      'openaiBaseUrl',
      'openaiModel'
    ])
    this._mobxUtils.propSync(AiCoachMain.id, 'state', this.state, [
      'hasAnthropicKey',
      'hasOpenaiKey',
      'canPersistKeys'
    ])
    this._ipcHandlers.register()
  }

  async onDispose() {
    this._chatController.dispose()
  }
}
