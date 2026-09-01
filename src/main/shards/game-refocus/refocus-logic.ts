/**
 * [lolps] 复活自动切回：纯逻辑层（无副作用，供控制器与单元测试复用）
 */

export interface RefocusSample {
  /** 本人是否处于死亡状态 */
  isDead: boolean
  /** 距复活的剩余秒数（存活时为 0） */
  respawnTimer: number
}

export type RefocusDecision = 'none' | 'fire'

/**
 * 每次死亡只触发一次：
 * - 观测到死亡 → 武装（armed）
 * - 武装后，剩余时间 ≤ 提前量，或已经复活（错过了提前窗口）→ 触发一次并解除武装
 * - 存活且未武装 → 无动作（开局、正常游戏、观战时找不到本人也不会走到这里）
 *
 * 顺序保证：同一次死亡不会二次触发；下一次死亡重新武装。
 */
export class RespawnRefocusTracker {
  private _armed = false
  private _firedForThisDeath = false

  constructor(private readonly _leadSeconds: number) {}

  /** 新对局 / 停止轮询时复位 */
  reset() {
    this._armed = false
    this._firedForThisDeath = false
  }

  get armed() {
    return this._armed
  }

  observe(sample: RefocusSample): RefocusDecision {
    const respawnTimer = Number.isFinite(sample.respawnTimer) ? sample.respawnTimer : 0

    if (sample.isDead) {
      if (!this._armed) {
        this._armed = true
        this._firedForThisDeath = false
      }
      if (!this._firedForThisDeath && respawnTimer <= this._leadSeconds) {
        this._firedForThisDeath = true
        return 'fire'
      }
      return 'none'
    }

    // 已复活
    if (this._armed) {
      const missedWindow = !this._firedForThisDeath
      this._armed = false
      this._firedForThisDeath = false
      // 两次轮询之间直接从“死亡且剩余 > 提前量”跳到“已复活”（极短复活/网络抖动）：补一次触发
      return missedWindow ? 'fire' : 'none'
    }
    return 'none'
  }
}

/**
 * 生成把游戏窗口拉回前台的 PowerShell 脚本。
 *
 * 只做窗口激活（WScript.Shell.AppActivate 按进程 id；失败时用 user32 的
 * ShowWindowAsync + SetForegroundWindow 兜底），不含任何按键/鼠标模拟——
 * 这是与反作弊边界相关的硬约束，改动时务必保持。
 *
 * 注意：PowerShell 里 `$PID` 是保留的自动变量，脚本内一律使用 `$targetPid`。
 */
export function buildActivateWindowScript(pid: number): string {
  const targetPid = Math.trunc(pid)
  if (!Number.isFinite(targetPid) || targetPid <= 0) {
    throw new Error(`invalid pid: ${pid}`)
  }
  return [
    `$targetPid = ${targetPid}`,
    `$shell = New-Object -ComObject WScript.Shell`,
    `$ok = $false`,
    `try { $ok = $shell.AppActivate($targetPid) } catch { $ok = $false }`,
    `if (-not $ok) {`,
    `  $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue`,
    `  if ($p -and $p.MainWindowHandle -ne 0) {`,
    `    Add-Type -Namespace AkariRefocus -Name Win32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr h, int c); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);'`,
    `    [AkariRefocus.Win32]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null`,
    `    [AkariRefocus.Win32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null`,
    `  }`,
    `}`
  ].join('\n')
}

/** PowerShell -EncodedCommand 要求 UTF-16LE 的 Base64；用它避免任何引号/换行转义问题 */
export function encodePowershellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/** 只有在确认自己没在游戏前台时才需要切；无法判断（未提权）时保守地视为“需要切” */
export function shouldActivate(foregroundKnown: boolean, gameIsForeground: boolean): boolean {
  if (!foregroundKnown) return true
  return !gameIsForeground
}
