import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import { describe, expect, it, vi } from 'vitest'

import { loadPostGameSummary } from './post-game-summary-loader'

function summary(source: 'sgp' | 'lcu', gameId = 42): LcuOrSgpGameSummary {
  return {
    source,
    gameId,
    data: source === 'sgp' ? { json: { gameId } } : { gameId }
  } as LcuOrSgpGameSummary
}

describe('post-game summary loading', () => {
  it('shows the LCU result immediately and upgrades the same game when SGP arrives', async () => {
    const lcu = summary('lcu')
    const sgp = summary('sgp')
    const getSgpSummary = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(sgp)
    const getLcuSummary = vi.fn().mockResolvedValue(lcu)
    const onSummary = vi.fn()
    const result = await loadPostGameSummary(42, {
      getSgpSummary,
      getLcuSummary,
      onSummary,
      signal: new AbortController().signal,
      intervalMs: 0,
      attempts: 3
    })
    expect(onSummary.mock.calls.map(([value]) => value.source)).toEqual(['lcu', 'sgp'])
    expect(result).toBe(sgp)
    expect(getLcuSummary).toHaveBeenCalledTimes(1)
    expect(getSgpSummary).toHaveBeenCalledTimes(2)
  })

  it('keeps the available LCU result after the bounded SGP retry window', async () => {
    const lcu = summary('lcu')
    const getSgpSummary = vi.fn().mockRejectedValue(new Error('not available'))
    const onSummary = vi.fn()
    expect(
      await loadPostGameSummary(42, {
        getSgpSummary,
        getLcuSummary: async () => lcu,
        onSummary,
        signal: new AbortController().signal,
        intervalMs: 0,
        attempts: 2
      })
    ).toBe(lcu)
    expect(getSgpSummary).toHaveBeenCalledTimes(2)
    expect(onSummary).toHaveBeenCalledTimes(1)
  })

  it('finishes as soon as LCU is available when SGP is unsupported', async () => {
    const lcu = summary('lcu')
    const onAttempt = vi.fn()
    expect(
      await loadPostGameSummary(42, {
        getLcuSummary: async () => lcu,
        onSummary: vi.fn(),
        onAttempt,
        signal: new AbortController().signal
      })
    ).toBe(lcu)
    expect(onAttempt).toHaveBeenCalledTimes(1)
  })

  it('discards an in-flight result after cancellation and starts no fallback request', async () => {
    const controller = new AbortController()
    let finish!: (value: LcuOrSgpGameSummary) => void
    const pending = new Promise<LcuOrSgpGameSummary>((resolve) => {
      finish = resolve
    })
    const getLcuSummary = vi.fn()
    const onSummary = vi.fn()
    const result = loadPostGameSummary(42, {
      getSgpSummary: () => pending,
      getLcuSummary,
      onSummary,
      signal: controller.signal
    })
    controller.abort()
    finish(summary('sgp'))
    expect(await result).toBeNull()
    expect(onSummary).not.toHaveBeenCalled()
    expect(getLcuSummary).not.toHaveBeenCalled()
  })

  it('accepts neither another game nor a mismatched raw game identity', async () => {
    const wrongRaw = summary('lcu', 99)
    wrongRaw.gameId = 42
    const onSummary = vi.fn()
    const result = await loadPostGameSummary(42, {
      getSgpSummary: async () => summary('sgp', 99),
      getLcuSummary: async () => wrongRaw,
      onSummary,
      signal: new AbortController().signal,
      attempts: 1
    })
    expect(result).toBeNull()
    expect(onSummary).not.toHaveBeenCalled()
  })

  it('does not fetch anything when cancelled before loading', async () => {
    const controller = new AbortController()
    controller.abort()
    const getLcuSummary = vi.fn()
    expect(
      await loadPostGameSummary(42, {
        getLcuSummary,
        onSummary: vi.fn(),
        signal: controller.signal
      })
    ).toBeNull()
    expect(getLcuSummary).not.toHaveBeenCalled()
  })
})
