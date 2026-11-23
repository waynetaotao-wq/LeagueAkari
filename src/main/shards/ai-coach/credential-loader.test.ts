import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiCoachCredentialLoader, type AiCoachKeyCipher } from './credential-loader'

const CLAUDE_KEY = 'sk-ant-test-0123456789abcdef'
const OTHER_KEY = 'sk-other-test-fedcba9876543210'
const cleanups: Array<() => unknown> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Stands in for the system's encryption: reversible, and never equal to the plain text. */
function createCipher(values: Partial<AiCoachKeyCipher> = {}): AiCoachKeyCipher {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from([...Buffer.from(`sealed:${text}`, 'utf8')].reverse()),
    decryptString: (sealed) => {
      const text = Buffer.from([...sealed].reverse()).toString('utf8')
      if (!text.startsWith('sealed:')) throw new Error('not sealed by this cipher')
      return text.slice('sealed:'.length)
    },
    ...values
  }
}

async function createHarness(cipher = createCipher()) {
  const directory = await mkdtemp(join(tmpdir(), 'akari-ai-coach-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'profile', 'ai-coach-credentials.json')
  const logger = { warn: vi.fn(), info: vi.fn() }
  const create = (nextCipher = cipher) => new AiCoachCredentialLoader(filePath, nextCipher, logger)
  const logged = () => JSON.stringify([...logger.warn.mock.calls, ...logger.info.mock.calls])
  return { directory, filePath, logger, logged, create, loader: create() }
}

describe('AiCoachCredentialLoader', () => {
  it('keeps a key across restarts without writing it in the clear', async () => {
    const { loader, create, filePath } = await createHarness()

    await expect(loader.set('anthropic', `  ${CLAUDE_KEY}\n`)).resolves.toEqual({
      result: 'ok',
      persisted: true
    })
    expect(loader.get('anthropic')).toBe(CLAUDE_KEY)

    const file = await readFile(filePath, 'utf8')
    expect(file).not.toContain(CLAUDE_KEY)
    expect(JSON.parse(file)).toEqual({ version: 1, keys: { anthropic: expect.any(String) } })

    const restarted = create()
    expect(restarted.has('anthropic')).toBe(false)
    await restarted.load()
    expect(restarted.get('anthropic')).toBe(CLAUDE_KEY)
    expect(restarted.has('openai-compatible')).toBe(false)
  })

  it('keeps one key per provider and removes them separately', async () => {
    const { loader, create, filePath, directory } = await createHarness()
    await loader.set('anthropic', CLAUDE_KEY)
    await loader.set('openai-compatible', OTHER_KEY)

    await expect(loader.clear('anthropic')).resolves.toBe(true)
    expect(loader.get('anthropic')).toBeNull()
    expect(loader.get('openai-compatible')).toBe(OTHER_KEY)

    const restarted = create()
    await restarted.load()
    expect(restarted.has('anthropic')).toBe(false)
    expect(restarted.get('openai-compatible')).toBe(OTHER_KEY)

    // With the last key gone nothing is left on disk, not even an empty file.
    await loader.clear('openai-compatible')
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(directory, 'profile'))).toEqual([])
  })

  it('replaces a key with the one entered later', async () => {
    const { loader, create } = await createHarness()
    await loader.set('anthropic', CLAUDE_KEY)
    await loader.set('anthropic', OTHER_KEY)

    const restarted = create()
    await restarted.load()
    expect(restarted.get('anthropic')).toBe(OTHER_KEY)
  })

  it.each([
    ['an unknown provider', 'openai', CLAUDE_KEY, 'invalid-provider'],
    ['an empty key', 'anthropic', '   ', 'invalid-key'],
    ['a key with a blank inside', 'anthropic', 'sk-ant test 0123456789', 'invalid-key'],
    ['something that is not text', 'anthropic', { key: CLAUDE_KEY }, 'invalid-key']
  ])('rejects %s and saves nothing', async (_, provider, value, reason) => {
    const { loader, filePath } = await createHarness()

    await expect(loader.set(provider, value)).resolves.toEqual({ result: 'failed', reason })
    expect(loader.has('anthropic')).toBe(false)
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(loader.clear('openai')).resolves.toBe(false)
  })

  it('holds the key only in memory when the system cannot encrypt', async () => {
    const { loader, create, filePath } = await createHarness(
      createCipher({ isEncryptionAvailable: () => false })
    )

    expect(loader.canPersist).toBe(false)
    await expect(loader.set('anthropic', CLAUDE_KEY)).resolves.toEqual({
      result: 'ok',
      persisted: false
    })
    expect(loader.get('anthropic')).toBe(CLAUDE_KEY)
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const restarted = create()
    await restarted.load()
    expect(restarted.has('anthropic')).toBe(false)
  })

  it('treats a check for encryption that throws as no encryption', async () => {
    const { loader } = await createHarness(
      createCipher({
        isEncryptionAvailable: () => {
          throw new Error('not ready')
        }
      })
    )

    expect(loader.canPersist).toBe(false)
    await expect(loader.set('anthropic', CLAUDE_KEY)).resolves.toEqual({
      result: 'ok',
      persisted: false
    })
  })

  it.each([
    ['is not JSON', '{ broken'],
    ['has another layout', JSON.stringify({ version: 2, keys: { anthropic: 'abc' } })],
    ['has no keys', JSON.stringify({ version: 1 })],
    ['holds a list', JSON.stringify([1, 2, 3])]
  ])('starts without keys when the saved file %s', async (_, content) => {
    const { loader, filePath } = await createHarness()
    await loader.set('anthropic', CLAUDE_KEY)
    await writeFile(filePath, content, 'utf8')

    const { create } = { create: () => loader }
    const restarted = create()
    await expect(restarted.load()).resolves.toBeUndefined()
    expect(restarted.has('anthropic')).toBe(false)
    expect(restarted.has('openai-compatible')).toBe(false)
  })

  it('skips a key sealed on another account and keeps the readable one', async () => {
    const { loader, create, filePath, logged } = await createHarness()
    await loader.set('anthropic', CLAUDE_KEY)
    await loader.set('openai-compatible', OTHER_KEY)
    const stored = JSON.parse(await readFile(filePath, 'utf8'))
    stored.keys.anthropic = Buffer.from('sealed elsewhere').toString('base64')
    await writeFile(filePath, JSON.stringify(stored), 'utf8')

    const restarted = create()
    await restarted.load()

    expect(restarted.has('anthropic')).toBe(false)
    expect(restarted.get('openai-compatible')).toBe(OTHER_KEY)
    expect(logged()).toContain('anthropic')
  })

  it('keeps the key usable and says so when it cannot be written', async () => {
    const { loader, logged } = await createHarness(
      createCipher({
        encryptString: () => {
          throw new Error('encryption failed')
        }
      })
    )

    await expect(loader.set('anthropic', CLAUDE_KEY)).resolves.toEqual({
      result: 'failed',
      reason: 'write-failed'
    })
    expect(loader.get('anthropic')).toBe(CLAUDE_KEY)
    expect(logged()).not.toContain(CLAUDE_KEY)
  })

  it('keeps the file whole when several keys are saved at once', async () => {
    const { loader, create } = await createHarness()

    await Promise.all([
      loader.set('anthropic', CLAUDE_KEY),
      loader.set('openai-compatible', OTHER_KEY),
      loader.set('anthropic', `${CLAUDE_KEY}-2`)
    ])

    const restarted = create()
    await restarted.load()
    expect(restarted.get('anthropic')).toBe(`${CLAUDE_KEY}-2`)
    expect(restarted.get('openai-compatible')).toBe(OTHER_KEY)
  })

  it('never writes a key to the log', async () => {
    const { loader, create, filePath, logged } = await createHarness()
    await loader.set('anthropic', CLAUDE_KEY)
    await loader.set('openai-compatible', OTHER_KEY)
    await writeFile(filePath, '{ broken', 'utf8')
    await create().load()
    await loader.clear('anthropic')
    await loader.set('anthropic', 'short')

    expect(logged()).not.toContain(CLAUDE_KEY)
    expect(logged()).not.toContain(OTHER_KEY)
  })
})
