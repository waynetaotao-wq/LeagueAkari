import {
  FRIEND_REQUEST_TEST_LIMITS,
  type FriendRequestTestChatError,
  type FriendRequestTestMode,
  type FriendRequestTestOptions,
  type FriendRequestTestReason,
  type FriendRequestTestStartResult,
  type FriendRequestTestTarget,
  createFriendRequestTestSnapshot
} from '@shared/shards/friend-request-test'
import { isAxiosError } from 'axios'
import { z } from 'zod'

import type {
  FriendRequestTestContext,
  FriendRequestTestSession,
  FriendTestRelationship
} from './context'

const optionsSchema = z.object({
  riotId: z.string().trim().min(3).max(100),
  durationMinutes: z.number().int().min(1).max(FRIEND_REQUEST_TEST_LIMITS.maxDurationMinutes),
  intervalSeconds: z
    .number()
    .min(FRIEND_REQUEST_TEST_LIMITS.minIntervalSeconds)
    .max(FRIEND_REQUEST_TEST_LIMITS.maxIntervalSeconds),
  removeAccepted: z.boolean(),
  consented: z.literal(true)
})

interface TestRun {
  mode: FriendRequestTestMode
  abort: AbortController
  session: FriendRequestTestSession
  options: FriendRequestTestOptions
  target: FriendRequestTestTarget | null
  paused: boolean
  revision: number
  activeMs: number
  lastTick: number
  lastSendAt: number | null
  waitUntil: number | null
  timer: ReturnType<typeof setInterval> | null
  stopReason: FriendRequestTestReason | null
  chatError: FriendRequestTestChatError | null
  mutationStarted: boolean
}

class TestFinished extends Error {
  constructor(readonly reason: FriendRequestTestReason) {
    super(reason)
  }
}

const delay = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })

export class FriendRequestTestController {
  private _run: TestRun | null = null

  constructor(private readonly _context: FriendRequestTestContext) {}

  start(options: unknown, mode: FriendRequestTestMode = 'test'): FriendRequestTestStartResult {
    if (this._run) return { started: false, reason: 'busy' }
    const parsed = optionsSchema.safeParse(options)
    const parts = parsed.success ? parsed.data.riotId.split('#').map((part) => part.trim()) : []
    if (!parsed.success || parts.length !== 2 || parts.some((part) => !part)) {
      return { started: false, reason: 'invalid-options' }
    }
    const session = this._context.getSession()
    if (!session) return { started: false, reason: 'not-ready' }
    const run: TestRun = {
      mode,
      abort: new AbortController(),
      session,
      options: { ...parsed.data, removeAccepted: mode === 'test' && parsed.data.removeAccepted },
      target: null,
      paused: false,
      revision: 0,
      activeMs: 0,
      lastTick: performance.now(),
      lastSendAt: null,
      waitUntil: null,
      timer: null,
      stopReason: null,
      chatError: null,
      mutationStarted: false
    }
    this._run = run
    this._context.state.setSnapshot({
      ...createFriendRequestTestSnapshot(),
      mode,
      active: true,
      phase: 'checking',
      options: parsed.data,
      remainingMs: parsed.data.durationMinutes * 60_000
    })
    run.timer = setInterval(() => this._tick(run), 250)
    this._context.logger.info('Friend request test started')
    void this._execute(run, parts[0], parts[1])
    return { started: true }
  }

  pause() {
    const run = this._run
    if (!run || run.abort.signal.aborted || run.paused) return
    this._tick(run)
    if (run.abort.signal.aborted) return
    run.paused = true
    run.revision++
    this._context.state.update({ paused: true })
  }

  resume() {
    const run = this._run
    if (!run || run.abort.signal.aborted || !run.paused) return
    if (!this._sameSession(run)) {
      this.stop('session-changed')
      return
    }
    run.paused = false
    run.revision++
    run.lastTick = performance.now()
    this._context.state.update({ paused: false })
  }

  stop(reason: FriendRequestTestReason = 'user-stopped') {
    const run = this._run
    if (!run || run.abort.signal.aborted) return
    run.stopReason = reason
    run.abort.abort(new Error(reason))
    this._context.state.update({ phase: 'stopping', paused: false, reason })
  }

  private _sameSession(run: TestRun) {
    const current = this._context.getSession()
    return (
      current &&
      current.connection === run.session.connection &&
      current.selfPuuid === run.session.selfPuuid
    )
  }

  private _tick(run: TestRun) {
    if (this._run !== run || run.abort.signal.aborted) return
    if (!this._sameSession(run)) {
      this.stop('session-changed')
      return
    }
    this._advanceClock(run)
    this._context.state.update({
      remainingMs: Math.max(0, run.options.durationMinutes * 60_000 - run.activeMs),
      waitRemainingMs: run.waitUntil === null ? 0 : Math.max(0, run.waitUntil - run.activeMs)
    })
  }

  private _advanceClock(run: TestRun) {
    const now = performance.now()
    if (!run.paused) run.activeMs += Math.max(0, now - run.lastTick)
    run.lastTick = now
  }

  private async _gate(run: TestRun) {
    run.abort.signal.throwIfAborted()
    while (run.paused) {
      await delay(100, run.abort.signal)
    }
    if (!this._sameSession(run)) throw new Error('session-changed')
    run.abort.signal.throwIfAborted()
    this._advanceClock(run)
  }

  private async _wait(run: TestRun, until: number) {
    run.waitUntil = until
    try {
      while (true) {
        await this._gate(run)
        if (run.activeMs >= until) break
        await delay(Math.min(100, Math.max(1, until - run.activeMs)), run.abort.signal)
      }
      await this._gate(run)
    } finally {
      run.waitUntil = null
    }
  }

  private async _relationship(run: TestRun): Promise<FriendTestRelationship> {
    let inconsistentReads = 0
    while (true) {
      await this._gate(run)
      const revision = run.revision
      this._context.state.update({ lastOperation: 'relationship' })
      const relationship = await this._context.api.relationship(run.target!.puuid, run.abort.signal)
      run.abort.signal.throwIfAborted()
      if (!this._sameSession(run)) throw new Error('session-changed')
      // A pause can last indefinitely. Never act on a relationship read before that pause.
      if (run.paused || revision !== run.revision) continue
      this._advanceClock(run)
      // Chat's two lists are not an atomic snapshot while a request is accepted.
      if (relationship.friend && relationship.request) {
        if (++inconsistentReads >= 3) throw new Error('invalid-response')
        await this._wait(run, run.activeMs + 1000)
        continue
      }
      if (relationship.request && relationship.request.direction !== 'out')
        throw new TestFinished('incoming-request')
      return relationship
    }
  }

  private _beginMutation(run: TestRun, operation: 'send' | 'withdraw' | 'remove') {
    run.chatError = null
    run.mutationStarted = true
    this._context.state.update({ lastOperation: operation, chatError: null })
  }

  private async _confirmRelationship(run: TestRun, operation: 'send' | 'withdraw' | 'remove') {
    // A successful LCU response only acknowledges a queued chat operation. Allow a
    // delayed server update, and require two empty observations before another send.
    const startedAt = run.activeMs
    const deadline = startedAt + 15_000
    let emptySince: number | null = null
    let emptyRevision = run.revision
    while (true) {
      const relationship = await this._relationship(run)
      if (operation === 'send') {
        if (relationship.friend || relationship.request) return relationship
      } else {
        if (operation === 'withdraw' && relationship.friend) return relationship
        if (!relationship.friend && !relationship.request) {
          if (
            emptySince !== null &&
            emptyRevision === run.revision &&
            run.activeMs - emptySince >= 500
          )
            return relationship
          emptySince = run.activeMs
          emptyRevision = run.revision
        } else {
          emptySince = null
        }
      }
      if (run.activeMs >= deadline) break
      const elapsed = run.activeMs - startedAt
      const pollingMs = emptySince !== null || elapsed < 2000 ? 500 : elapsed < 5000 ? 1000 : 2000
      await this._wait(run, Math.min(deadline, run.activeMs + pollingMs))
    }
    this._context.state.update({ lastOperation: operation, chatError: run.chatError })
    throw new Error(operation === 'send' ? 'request-not-confirmed' : 'removal-not-confirmed')
  }

  private async _clearRelationship(run: TestRun) {
    let mayRemoveAcceptedAfterWithdrawal = true
    let emptyReads = 0
    while (true) {
      const relationship = await this._relationship(run)
      if (!relationship.friend && !relationship.request) {
        if (++emptyReads >= 3) {
          this._context.state.update({ mayHaveRelationship: false })
          throw new TestFinished('request-disappeared')
        }
        await this._wait(run, run.activeMs + 1000)
        continue
      }
      if (relationship.friend && !run.options.removeAccepted)
        throw new TestFinished('accepted-kept')
      this._context.state.update({ phase: 'removing' })
      const deletingFriend = !!relationship.friend
      try {
        if (relationship.friend) {
          this._beginMutation(run, 'remove')
          await this._context.api.remove(relationship.friend.id, run.abort.signal)
        } else {
          this._beginMutation(run, 'withdraw')
          await this._context.api.withdraw(run.target!.puuid, run.abort.signal)
        }
      } catch (error) {
        // Acceptance may win a race with withdrawal. Inspect it once; never retry the write.
        if (
          !deletingFriend &&
          mayRemoveAcceptedAfterWithdrawal &&
          isAxiosError(error) &&
          [404, 409].includes(error.response?.status ?? 0)
        ) {
          const current = await this._relationship(run)
          if (current.friend) {
            mayRemoveAcceptedAfterWithdrawal = false
            continue
          }
        }
        throw error
      }
      run.abort.signal.throwIfAborted()
      this._context.state.update({ phase: 'confirming' })
      const current = await this._confirmRelationship(run, deletingFriend ? 'remove' : 'withdraw')
      if (!current.friend && !current.request) {
        const snapshot = this._context.state.snapshot
        this._context.state.update({
          withdrawn: snapshot.withdrawn + (deletingFriend ? 0 : 1),
          removed: snapshot.removed + (deletingFriend ? 1 : 0),
          mayHaveRelationship: false
        })
        return
      }
      if (current.friend && mayRemoveAcceptedAfterWithdrawal) {
        mayRemoveAcceptedAfterWithdrawal = false
        continue
      }
      throw new Error('removal-not-confirmed')
    }
  }

  private async _execute(run: TestRun, gameName: string, tagLine: string) {
    let phase: 'completed' | 'failed' | 'stopped' = 'completed'
    let reason: FriendRequestTestReason = 'finished'
    let stopWatching = () => {}
    try {
      stopWatching = this._context.api.watchChatErrors((error) => {
        if (
          this._run === run &&
          !run.abort.signal.aborted &&
          run.mutationStarted &&
          this._sameSession(run)
        )
          run.chatError = error
      })
      await this._gate(run)
      this._context.state.update({ lastOperation: 'resolve' })
      const target = await this._context.api.resolve(gameName, tagLine, run.abort.signal)
      await this._gate(run)
      if (!target) throw new Error('target-not-found')
      if (target.puuid === run.session.selfPuuid) throw new Error('self-target')
      run.target = target
      this._context.state.update({ target })
      const baseline = await this._relationship(run)
      if (run.mode === 'withdraw-only') {
        if (baseline.friend) throw new TestFinished('accepted-kept')
        if (!baseline.request) throw new TestFinished('no-outgoing-request')
        this._context.state.update({ mayHaveRelationship: true })
        await this._clearRelationship(run)
        reason = 'withdrawn-only'
        return
      }
      if (baseline.friend || baseline.request) throw new Error('existing-relationship')
      while (run.activeMs < run.options.durationMinutes * 60_000) {
        await this._gate(run)
        if (run.activeMs >= run.options.durationMinutes * 60_000) break
        // Every send starts from a freshly empty relationship, even after pause/resume.
        const beforeSend = await this._relationship(run)
        if (beforeSend.friend || beforeSend.request) throw new Error('existing-relationship')
        if (run.activeMs >= run.options.durationMinutes * 60_000) break
        const cycleStart = run.activeMs
        const sendAt = performance.now()
        this._context.state.update({
          phase: 'sending',
          mayHaveRelationship: true,
          lastSendIntervalMs: run.lastSendAt === null ? null : sendAt - run.lastSendAt
        })
        this._beginMutation(run, 'send')
        run.lastSendAt = sendAt
        await this._context.api.send(target, run.abort.signal)
        run.abort.signal.throwIfAborted()
        this._context.state.update({ phase: 'confirming' })
        const sent = await this._confirmRelationship(run, 'send')
        this._context.state.update({ sent: this._context.state.snapshot.sent + 1 })
        if (sent.friend && !run.options.removeAccepted) throw new TestFinished('accepted-kept')
        this._context.state.update({ phase: 'waiting' })
        await this._wait(
          run,
          Math.min(
            cycleStart + run.options.intervalSeconds * 1000,
            run.options.durationMinutes * 60_000
          )
        )
        await this._clearRelationship(run)
      }
    } catch (error) {
      if (run.abort.signal.aborted) {
        phase = 'stopped'
        reason = run.stopReason ?? 'user-stopped'
      } else if (error instanceof TestFinished) {
        reason = error.reason
      } else {
        phase = 'failed'
        this._context.state.update({
          httpStatus: isAxiosError(error) ? (error.response?.status ?? null) : null
        })
        const known: FriendRequestTestReason[] = [
          'session-changed',
          'target-not-found',
          'self-target',
          'existing-relationship',
          'invalid-response',
          'request-not-confirmed',
          'removal-not-confirmed'
        ]
        reason =
          isAxiosError(error) && error.response?.status === 429
            ? 'rate-limited'
            : error instanceof Error && known.includes(error.message as FriendRequestTestReason)
              ? (error.message as FriendRequestTestReason)
              : 'request-failed'
      }
    } finally {
      stopWatching()
      if (run.timer) clearInterval(run.timer)
      run.abort.abort()
      if (this._run === run) {
        this._run = null
        this._context.state.update({
          active: false,
          paused: false,
          phase,
          reason,
          waitRemainingMs: 0,
          remainingMs: Math.max(0, run.options.durationMinutes * 60_000 - run.activeMs)
        })
        this._context.logger.info('Friend request test ended', {
          phase,
          reason,
          mode: run.mode,
          sent: this._context.state.snapshot.sent,
          withdrawn: this._context.state.snapshot.withdrawn,
          removed: this._context.state.snapshot.removed,
          operation: this._context.state.snapshot.lastOperation,
          httpStatus: this._context.state.snapshot.httpStatus,
          chatError: this._context.state.snapshot.chatError
        })
      }
    }
  }
}
