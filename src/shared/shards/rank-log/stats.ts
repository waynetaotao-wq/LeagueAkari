// [lolps] 上分日志的统计：把一条队列的日志整理成曲线、连胜连败、每天净胜点和状态分析。纯计算。
import type { RankLogEntryDto, RankLogQueueType } from './index'

/** 上一局结束到下一局开始隔了这么久，就算重新坐下来打的另一段。 */
export const RANK_LOG_SESSION_GAP_MS = 60 * 60_000
/** 一天从凌晨 5 点算起，打到后半夜的对局仍归前一天。 */
export const RANK_LOG_DAY_START_HOUR = 5
/** 「近期」统计的场数。 */
export const RANK_LOG_RECENT_GAMES = 20
/** 连败达到这个数就提示休息，也是「连败后继续打」统计的门槛。 */
export const RANK_LOG_TILT_LOSS_STREAK = 2
/** 少于这个场数的胜率只列场次，不显示百分比。 */
export const RANK_LOG_MIN_RATE_GAMES = 5
/** 「一段里的第几局」分到第几档为止，最后一档包含之后的所有局。 */
export const RANK_LOG_SESSION_INDEX_BUCKETS = 5

export interface RankLogTally {
  games: number
  wins: number
  losses: number
  /** Sum of the known point changes. */
  lpDelta: number
  /** How many of the games carry a point change. */
  lpGames: number
}

/** A game that counted: it has a result and was not remade. */
export interface RankLogGame {
  entry: RankLogEntryDto
  win: boolean
  startedAt: number
  endedAt: number
  /** 1-based position inside its session. */
  sessionIndex: number
  /** Straight losses in the same session right before this game. */
  lossesBefore: number
}

export interface RankLogSession {
  startedAt: number
  endedAt: number
  tally: RankLogTally
  /** Straight losses the session ended with. */
  lossStreak: number
}

export interface RankLogDay {
  /** Local date `YYYY-MM-DD` of the day that started at five in the morning. */
  day: string
  tally: RankLogTally
  /** Net change of every reading that day, games, gaps and adjustments alike; null when none is known. */
  net: number | null
}

/** One rank reading on the continuous point scale. */
export interface RankLogPoint {
  entry: RankLogEntryDto
  absoluteLp: number
}

export interface RankLogSummary {
  /** The latest entry that carries a rank reading. */
  current: RankLogEntryDto | null
  /** Every comparable reading, oldest first. */
  points: RankLogPoint[]
  /** Change between the first and the latest comparable reading since the last starting point. */
  net: number | null
  /** When the reading `net` is measured from was taken; null together with `net`. */
  netSince: number | null
  /** Counted games, oldest first. */
  games: RankLogGame[]
  total: RankLogTally
  recent: RankLogTally
  streak: { win: boolean; length: number } | null
  /** Oldest first. */
  sessions: RankLogSession[]
  /** The last session while the player may still be in it. */
  activeSession: RankLogSession | null
  /** Index 0 is the first game of a session; the last bucket holds every later game. */
  bySessionIndex: RankLogTally[]
  /** Games started right after at least two straight losses in the same session. */
  afterLossStreak: RankLogTally
  /** Every other counted game, the comparison for `afterLossStreak`. */
  otherGames: RankLogTally
  /** Newest first. */
  days: RankLogDay[]
  averageWinLp: number | null
  averageLossLp: number | null
  /** Counted games that carry no point change. */
  unrecordedGames: number
  /** Entries that fold several unseen games into one change. */
  gaps: number
  adjustments: { count: number; lpDelta: number }
}

const emptyTally = (): RankLogTally => ({ games: 0, wins: 0, losses: 0, lpDelta: 0, lpGames: 0 })

function addToTally(tally: RankLogTally, game: RankLogGame) {
  tally.games++
  if (game.win) tally.wins++
  else tally.losses++
  if (game.entry.lpDelta !== null) {
    tally.lpDelta += game.entry.lpDelta
    tally.lpGames++
  }
}

function tallyOf(games: readonly RankLogGame[]) {
  const tally = emptyTally()
  games.forEach((game) => addToTally(tally, game))
  return tally
}

/** Win rate in percent; null below the minimum sample so a handful of games is not read as a trend. */
export function rankLogWinRate(tally: RankLogTally, minGames = RANK_LOG_MIN_RATE_GAMES) {
  return tally.games >= Math.max(1, minGames) ? (100 * tally.wins) / tally.games : null
}

/** The local day a moment belongs to, with the day starting at `RANK_LOG_DAY_START_HOUR`. */
export function rankLogDay(timestamp: number, timezoneOffsetMinutes?: number) {
  const shifted = timestamp - RANK_LOG_DAY_START_HOUR * 3_600_000
  const pad = (value: number) => String(value).padStart(2, '0')
  if (timezoneOffsetMinutes === undefined) {
    const date = new Date(shifted)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }
  const date = new Date(shifted + timezoneOffsetMinutes * 60_000)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

export function summarizeRankLog(
  entries: readonly RankLogEntryDto[],
  options: {
    queueType: RankLogQueueType
    now: number
    /** Minutes east of UTC; the machine's own zone when omitted. Tests pass it to stay stable. */
    timezoneOffsetMinutes?: number
  }
): RankLogSummary {
  const own = entries.filter((entry) => entry.queueType === options.queueType)

  // 段位读数按读到的先后排，对局按结束的先后排：补录的对局没有读数，两种顺序不能混用。
  const readings = own
    .filter((entry) => entry.observedAt !== null)
    .sort((a, b) => a.observedAt! - b.observedAt! || a.id - b.id)
  const points = readings.flatMap((entry) =>
    entry.absoluteLp === null ? [] : [{ entry, absoluteLp: entry.absoluteLp }]
  )
  const lastBaseline = readings.findLast((entry) => entry.kind === 'baseline')
  const segment = lastBaseline
    ? points.filter(
        (point) =>
          point.entry.observedAt! > lastBaseline.observedAt! ||
          (point.entry.observedAt === lastBaseline.observedAt && point.entry.id >= lastBaseline.id)
      )
    : points

  const games: RankLogGame[] = own
    .filter((entry) => entry.kind === 'game' && entry.win !== null && entry.remake !== true)
    .sort((a, b) => a.occurredAt - b.occurredAt || a.id - b.id)
    .map((entry) => ({
      entry,
      win: entry.win === true,
      startedAt:
        entry.gameCreation ??
        (entry.gameDuration !== null
          ? entry.occurredAt - entry.gameDuration * 1000
          : entry.occurredAt),
      endedAt: entry.occurredAt,
      sessionIndex: 1,
      lossesBefore: 0
    }))

  const sessionGames: RankLogGame[][] = []
  for (const game of games) {
    const session = sessionGames.at(-1)
    const previous = session?.at(-1)
    if (!session || !previous || game.startedAt - previous.endedAt > RANK_LOG_SESSION_GAP_MS) {
      sessionGames.push([game])
      continue
    }
    game.sessionIndex = session.length + 1
    game.lossesBefore = previous.win ? 0 : previous.lossesBefore + 1
    session.push(game)
  }
  const sessions = sessionGames.map((session) => {
    const last = session.at(-1)!
    return {
      startedAt: session[0].startedAt,
      endedAt: last.endedAt,
      tally: tallyOf(session),
      lossStreak: last.win ? 0 : last.lossesBefore + 1
    }
  })
  const lastSession = sessions.at(-1)

  const bySessionIndex = Array.from({ length: RANK_LOG_SESSION_INDEX_BUCKETS }, emptyTally)
  const afterLossStreak = emptyTally()
  const otherGames = emptyTally()
  for (const game of games) {
    addToTally(
      bySessionIndex[Math.min(game.sessionIndex, RANK_LOG_SESSION_INDEX_BUCKETS) - 1],
      game
    )
    addToTally(game.lossesBefore >= RANK_LOG_TILT_LOSS_STREAK ? afterLossStreak : otherGames, game)
  }

  let streak: RankLogSummary['streak'] = null
  for (const game of games.toReversed()) {
    if (!streak) streak = { win: game.win, length: 1 }
    else if (streak.win === game.win) streak.length++
    else break
  }

  const days = new Map<string, { games: RankLogGame[]; changes: number[] }>()
  const dayOf = (timestamp: number) => {
    const key = rankLogDay(timestamp, options.timezoneOffsetMinutes)
    let day = days.get(key)
    if (!day) days.set(key, (day = { games: [], changes: [] }))
    return day
  }
  games.forEach((game) => dayOf(game.endedAt).games.push(game))
  for (const entry of own) {
    if (entry.lpDelta !== null) dayOf(entry.occurredAt).changes.push(entry.lpDelta)
  }

  const adjustments = own.filter((entry) => entry.kind === 'adjustment')
  return {
    current: readings.at(-1) ?? null,
    points,
    net: segment.length >= 2 ? segment.at(-1)!.absoluteLp - segment[0].absoluteLp : null,
    netSince: segment.length >= 2 ? segment[0].entry.observedAt : null,
    games,
    total: tallyOf(games),
    recent: tallyOf(games.slice(-RANK_LOG_RECENT_GAMES)),
    streak,
    sessions,
    activeSession:
      lastSession && options.now - lastSession.endedAt <= RANK_LOG_SESSION_GAP_MS
        ? lastSession
        : null,
    bySessionIndex,
    afterLossStreak,
    otherGames,
    days: [...days.entries()]
      .sort(([first], [second]) => second.localeCompare(first))
      .map(([day, value]) => ({
        day,
        tally: tallyOf(value.games),
        net: value.changes.length ? value.changes.reduce((sum, change) => sum + change, 0) : null
      })),
    averageWinLp: mean(
      games.flatMap((game) => (game.win && game.entry.lpDelta !== null ? [game.entry.lpDelta] : []))
    ),
    averageLossLp: mean(
      games.flatMap((game) =>
        !game.win && game.entry.lpDelta !== null ? [game.entry.lpDelta] : []
      )
    ),
    unrecordedGames: games.filter((game) => game.entry.lpDelta === null).length,
    gaps: own.filter((entry) => entry.kind === 'gap').length,
    adjustments: {
      count: adjustments.length,
      lpDelta: adjustments.reduce((sum, entry) => sum + (entry.lpDelta ?? 0), 0)
    }
  }
}
