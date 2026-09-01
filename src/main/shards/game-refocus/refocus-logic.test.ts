import { describe, expect, it } from 'vitest'

import {
  RespawnRefocusTracker,
  buildActivateWindowScript,
  encodePowershellCommand,
  shouldActivate
} from './refocus-logic'

describe('RespawnRefocusTracker', () => {
  it('does nothing while alive (game start, normal play)', () => {
    const t = new RespawnRefocusTracker(2)
    expect(t.observe({ isDead: false, respawnTimer: 0 })).toBe('none')
    expect(t.observe({ isDead: false, respawnTimer: 0 })).toBe('none')
    expect(t.armed).toBe(false)
  })

  it('fires exactly once per death, at the lead window', () => {
    const t = new RespawnRefocusTracker(2)
    expect(t.observe({ isDead: true, respawnTimer: 12 })).toBe('none')
    expect(t.observe({ isDead: true, respawnTimer: 6.4 })).toBe('none')
    expect(t.observe({ isDead: true, respawnTimer: 2.9 })).toBe('none')
    expect(t.observe({ isDead: true, respawnTimer: 1.8 })).toBe('fire')
    // 仍处死亡状态的后续采样不再触发
    expect(t.observe({ isDead: true, respawnTimer: 1.2 })).toBe('none')
    expect(t.observe({ isDead: true, respawnTimer: 0.4 })).toBe('none')
    // 复活后不再触发，且武装解除
    expect(t.observe({ isDead: false, respawnTimer: 0 })).toBe('none')
    expect(t.armed).toBe(false)
  })

  it('re-arms on the next death', () => {
    const t = new RespawnRefocusTracker(2)
    t.observe({ isDead: true, respawnTimer: 5 })
    expect(t.observe({ isDead: true, respawnTimer: 1 })).toBe('fire')
    t.observe({ isDead: false, respawnTimer: 0 })
    t.observe({ isDead: true, respawnTimer: 20 })
    expect(t.observe({ isDead: true, respawnTimer: 2 })).toBe('fire')
  })

  it('catches up when respawn happened between two polls', () => {
    const t = new RespawnRefocusTracker(2)
    expect(t.observe({ isDead: true, respawnTimer: 3.5 })).toBe('none')
    // 下一次采样已经复活，错过了提前窗口：补一次触发，且只补一次
    expect(t.observe({ isDead: false, respawnTimer: 0 })).toBe('fire')
    expect(t.observe({ isDead: false, respawnTimer: 0 })).toBe('none')
  })

  it('fires immediately when first seen already inside the lead window', () => {
    const t = new RespawnRefocusTracker(2)
    expect(t.observe({ isDead: true, respawnTimer: 1.5 })).toBe('fire')
  })

  it('treats malformed timers as 0 and never throws', () => {
    const t = new RespawnRefocusTracker(2)
    expect(t.observe({ isDead: true, respawnTimer: Number.NaN })).toBe('fire')
    expect(t.observe({ isDead: false, respawnTimer: Number.NaN })).toBe('none')
  })

  it('reset clears an armed death', () => {
    const t = new RespawnRefocusTracker(2)
    t.observe({ isDead: true, respawnTimer: 10 })
    t.reset()
    expect(t.armed).toBe(false)
    // 复位后先看到“存活”不会误补触发
    expect(t.observe({ isDead: false, respawnTimer: 0 })).toBe('none')
  })
})

describe('shouldActivate', () => {
  it('skips when the game is known to be in foreground', () => {
    expect(shouldActivate(true, true)).toBe(false)
    expect(shouldActivate(true, false)).toBe(true)
  })

  it('activates conservatively when foreground cannot be detected', () => {
    expect(shouldActivate(false, false)).toBe(true)
    expect(shouldActivate(false, true)).toBe(true)
  })
})

describe('buildActivateWindowScript', () => {
  it('only performs window activation, never input simulation', () => {
    const script = buildActivateWindowScript(4321)
    expect(script).toContain('AppActivate($targetPid)')
    expect(script).toContain('SetForegroundWindow')
    expect(script).toContain('$targetPid = 4321')
    // 反作弊边界：不得出现任何按键 / 鼠标模拟
    expect(script).not.toMatch(/SendKeys|keybd_event|SendInput|mouse_event/i)
    // 不得改写 PowerShell 保留变量 $PID
    expect(script).not.toMatch(/\$pid\s*=/i)
  })

  it('rejects invalid pids', () => {
    expect(() => buildActivateWindowScript(0)).toThrow()
    expect(() => buildActivateWindowScript(-5)).toThrow()
    expect(() => buildActivateWindowScript(Number.NaN)).toThrow()
  })

  it('encodes as UTF-16LE base64 for -EncodedCommand', () => {
    const encoded = encodePowershellCommand('Write-Host 1')
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe('Write-Host 1')
  })
})
