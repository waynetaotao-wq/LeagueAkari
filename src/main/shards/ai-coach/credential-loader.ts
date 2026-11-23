import {
  AI_COACH_PROVIDERS,
  type AiCoachKeyResult,
  type AiCoachProvider,
  isAiCoachProvider,
  normalizeAiCoachKey
} from '@shared/shards/ai-coach'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { AkariLogger } from '../logger-factory'

/** The part of Electron's `safeStorage` this loader needs; tests pass a stand-in. */
export interface AiCoachKeyCipher {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

interface StoredKeys {
  version: 1
  keys: Partial<Record<AiCoachProvider, string>>
}

/**
 * Keeps the API keys the user typed in. Keys are held in memory for use and written to a
 * separate file only after the system's own encryption (DPAPI on Windows) has sealed them, so
 * the file is useless on another account or computer. Nothing here ever logs a key.
 */
export class AiCoachCredentialLoader {
  private readonly _keys = new Map<AiCoachProvider, string>()
  private _writeQueue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly _filePath: string,
    private readonly _cipher: AiCoachKeyCipher,
    private readonly _logger: Pick<AkariLogger, 'warn' | 'info'>
  ) {}

  get canPersist() {
    try {
      return this._cipher.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  has(provider: AiCoachProvider) {
    return this._keys.has(provider)
  }

  get(provider: AiCoachProvider) {
    return this._keys.get(provider) ?? null
  }

  /** Reads the saved keys. A missing or unreadable file simply means no key is saved. */
  async load() {
    this._keys.clear()
    if (!this.canPersist) {
      return
    }

    let stored: StoredKeys
    try {
      stored = JSON.parse(await readFile(this._filePath, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this._logger.warn('Saved AI coach keys could not be read; they need to be entered again')
      }
      return
    }

    if (stored?.version !== 1 || !stored.keys || typeof stored.keys !== 'object') {
      return
    }

    for (const provider of AI_COACH_PROVIDERS) {
      const sealed = stored.keys[provider]
      if (typeof sealed !== 'string' || !sealed) {
        continue
      }

      try {
        const key = normalizeAiCoachKey(this._cipher.decryptString(Buffer.from(sealed, 'base64')))
        if (key) {
          this._keys.set(provider, key)
        }
      } catch {
        // 换了系统账号或电脑后旧密钥解不开：当作没保存过。
        this._logger.warn(`Saved AI coach key for ${provider} could not be decrypted`)
      }
    }
  }

  async set(provider: unknown, value: unknown): Promise<AiCoachKeyResult> {
    if (!isAiCoachProvider(provider)) {
      return { result: 'failed', reason: 'invalid-provider' }
    }

    const key = normalizeAiCoachKey(value)
    if (!key) {
      return { result: 'failed', reason: 'invalid-key' }
    }

    this._keys.set(provider, key)
    if (!this.canPersist) {
      return { result: 'ok', persisted: false }
    }

    try {
      await this._persist()
      return { result: 'ok', persisted: true }
    } catch {
      this._logger.warn('AI coach key could not be saved; it stays in memory until the app closes')
      return { result: 'failed', reason: 'write-failed' }
    }
  }

  async clear(provider: unknown) {
    if (!isAiCoachProvider(provider)) {
      return false
    }

    this._keys.delete(provider)
    try {
      await this._persist()
    } catch {
      this._logger.warn('AI coach key file could not be updated after removing a key')
    }
    return true
  }

  /** One write at a time, through a temporary file, so a crash never leaves half a file. */
  private _persist() {
    const task = this._writeQueue.then(async () => {
      if (!this._keys.size) {
        await rm(this._filePath, { force: true })
        return
      }

      const stored: StoredKeys = { version: 1, keys: {} }
      for (const [provider, key] of this._keys) {
        stored.keys[provider] = this._cipher.encryptString(key).toString('base64')
      }
      const temporaryPath = `${this._filePath}.tmp`
      await mkdir(dirname(this._filePath), { recursive: true })
      await writeFile(temporaryPath, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, this._filePath)
    })
    this._writeQueue = task.catch(() => {})
    return task
  }
}
