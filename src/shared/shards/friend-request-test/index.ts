export const FRIEND_REQUEST_TEST_MAIN_NAMESPACE = 'friend-request-test-main'
export const FRIEND_REQUEST_TEST_LIMITS = {
  minIntervalSeconds: 0,
  maxIntervalSeconds: 3600,
  maxDurationMinutes: 60
} as const

export interface FriendRequestTestOptions {
  riotId: string
  durationMinutes: number
  intervalSeconds: number
  removeAccepted: boolean
  consented: boolean
}

export interface FriendRequestTestTarget {
  puuid: string
  gameName: string
  tagLine: string
}

export type FriendRequestTestPhase =
  | 'idle'
  | 'checking'
  | 'sending'
  | 'waiting'
  | 'removing'
  | 'confirming'
  | 'stopping'
  | 'completed'
  | 'stopped'
  | 'failed'

export type FriendRequestTestOperation = 'resolve' | 'relationship' | 'send' | 'withdraw' | 'remove'

export type FriendRequestTestReason =
  | 'invalid-options'
  | 'busy'
  | 'not-ready'
  | 'session-changed'
  | 'target-not-found'
  | 'self-target'
  | 'existing-relationship'
  | 'invalid-response'
  | 'request-not-confirmed'
  | 'request-disappeared'
  | 'incoming-request'
  | 'accepted-kept'
  | 'removal-not-confirmed'
  | 'rate-limited'
  | 'request-failed'
  | 'user-stopped'
  | 'window-closed'
  | 'finished'

export interface FriendRequestTestSnapshot {
  active: boolean
  paused: boolean
  phase: FriendRequestTestPhase
  reason: FriendRequestTestReason | null
  options: FriendRequestTestOptions | null
  target: FriendRequestTestTarget | null
  remainingMs: number
  waitRemainingMs: number
  sent: number
  withdrawn: number
  removed: number
  mayHaveRelationship: boolean
  lastSendIntervalMs: number | null
  lastOperation: FriendRequestTestOperation | null
  httpStatus: number | null
}

export function createFriendRequestTestSnapshot(): FriendRequestTestSnapshot {
  return {
    active: false,
    paused: false,
    phase: 'idle',
    reason: null,
    options: null,
    target: null,
    remainingMs: 0,
    waitRemainingMs: 0,
    sent: 0,
    withdrawn: 0,
    removed: 0,
    mayHaveRelationship: false,
    lastSendIntervalMs: null,
    lastOperation: null,
    httpStatus: null
  }
}

export type FriendRequestTestStartResult =
  { started: true } | { started: false; reason: FriendRequestTestReason }
