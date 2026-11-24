import { REVIEW_SNAPSHOT_TOLERANCE_MS } from './analysis'
import { type ReviewDeathZone, classifyReviewDeathZone } from './death-map'
import { REVIEW_CHECKPOINT_MINUTES } from './match-report'
import type { ReviewMatch, ReviewParticipantFrame, ReviewPosition } from './types'

// [lolps] 逐分钟表：时间线每分钟留一次快照，这里把它整理成本人和对位的累计数字、
// 十个人各自所在的区域，以及各路的经济差。只整理快照和事件里记录的数：快照缺什么，
// 这里就是 null，不补不估。

/** 各路经济差按这几个时间点给，和单局报告的检查点一致。 */
export const REVIEW_LANE_DIFF_MINUTES = REVIEW_CHECKPOINT_MINUTES

const LANE_ROLES: ReviewPosition[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

export interface ReviewMinuteSide {
  gold: number | null
  /** Gold in the purse, not yet spent. */
  unspentGold: number | null
  /** Lane minions plus jungle monsters. */
  cs: number | null
  level: number | null
  /** Cumulative damage dealt to champions. */
  damage: number | null
  /**
   * Cumulative damage taken, from champions, minions, monsters and turrets alike.
   * 实测 16.23：280 个视角的结算快照与战绩里的承伤逐一相等，逐行只增不减。
   */
  damageTaken: number | null
  /** Health at the instant of the snapshot and its maximum. */
  health: number | null
  healthMax: number | null
  /**
   * false when the player is dead at the snapshot. Not the same as zero health: a body lying
   * where it fell can report a few points of health (see `settleAlive` in analysis.ts).
   */
  alive: boolean | null
}

export interface ReviewMinutePlace {
  participantId: number
  /** Named from the reviewed player's side; null when the snapshot has no position. */
  zone: ReviewDeathZone | null
  /** false when the snapshot shows the player dead; null when it does not say. */
  alive: boolean | null
}

export interface ReviewMinuteRow {
  timestamp: number
  own: ReviewMinuteSide
  /** null when no lane opponent could be identified. */
  opponent: ReviewMinuteSide | null
  /** The reviewed player minus the lane opponent. */
  goldDiff: number | null
  csDiff: number | null
  /** The reviewed player's score up to this snapshot, counted from the recorded kills. */
  kills: number
  deaths: number
  assists: number
  /** The reviewed player's team minus the other team. */
  teamGoldDiff: number | null
  /** Champion kills of each team up to this snapshot; executions belong to neither. */
  ownTeamKills: number
  enemyTeamKills: number
  /** Where each of the ten players was, in the order of `match.participants`. */
  places: ReviewMinutePlace[]
}

// 快照里还有一个「资源」数（蓝量、能量、怒气……）。实测 16.23：不耗蓝的英雄报出来的数
// 各不相同，有的是 0，有的是 10000，亚索、弗拉基米尔、雷恩加尔等报的既不是 0 也不是整百；
// 不知道英雄用的是哪种资源就没法解读，所以不取。
const sideOf = (frame: ReviewParticipantFrame | undefined): ReviewMinuteSide => ({
  gold: frame?.gold ?? null,
  unspentGold: frame?.unspentGold ?? null,
  cs: frame?.cs ?? null,
  level: frame?.level ?? null,
  damage: frame?.damage ?? null,
  damageTaken: frame?.damageTaken ?? null,
  health: frame?.health ?? null,
  healthMax: frame?.healthMax ?? null,
  alive: frame?.alive ?? null
})

/**
 * One row per timeline snapshot after the start of the game, the closing snapshot included.
 * Numbers are cumulative up to the snapshot. The kill counts come from the kill events, so
 * they are lower bounds when the event log could not be reconciled with the summary.
 */
export function buildReviewMinuteRows(match: ReviewMatch): ReviewMinuteRow[] {
  const { meta } = match
  const kills = match.events
    .filter((event) => event.type === 'kill')
    .sort((a, b) => a.timestamp - b.timestamp)

  return match.frames
    .filter((frame) => frame.timestamp > 0)
    .map((frame) => {
      const byId = new Map(frame.participants.map((entry) => [entry.participantId, entry]))
      const score = { kills: 0, deaths: 0, assists: 0, ownTeamKills: 0, enemyTeamKills: 0 }
      for (const event of kills) {
        if (event.timestamp > frame.timestamp) break
        if (event.killerId === meta.participantId) score.kills++
        if (event.victimId === meta.participantId) score.deaths++
        if (event.assistingParticipantIds.includes(meta.participantId)) score.assists++
        if (event.teamId === meta.teamId) score.ownTeamKills++
        else if (event.teamId !== null) score.enemyTeamKills++
      }

      return {
        timestamp: frame.timestamp,
        own: sideOf(byId.get(meta.participantId)),
        opponent: meta.opponentId === null ? null : sideOf(byId.get(meta.opponentId)),
        goldDiff: frame.personalGoldDiff,
        csDiff: frame.personalCsDiff,
        ...score,
        teamGoldDiff: frame.teamGoldDiff,
        places: match.participants.map((participant) => {
          const entry = byId.get(participant.participantId)
          return {
            participantId: participant.participantId,
            zone: entry?.position ? classifyReviewDeathZone(entry.position, meta.teamId) : null,
            alive: entry?.alive ?? null
          }
        })
      }
    })
}

export interface ReviewLaneGoldDiff {
  minute: number
  /**
   * Gold of the reviewed player's side minus the other side, per role. A role is missing when
   * either team does not have exactly one player in it, or the snapshot lacks their gold.
   */
  roles: Array<{ role: ReviewPosition; diff: number }>
}

/** How each lane stood at the checkpoints: the state of the map around the reviewed player. */
export function buildReviewLaneGoldDiffs(match: ReviewMatch): ReviewLaneGoldDiff[] {
  const { meta } = match
  const pairs = LANE_ROLES.flatMap((role) => {
    const players = match.participants.filter((participant) => participant.position === role)
    const own = players.filter((participant) => participant.teamId === meta.teamId)
    const enemy = players.filter((participant) => participant.teamId !== meta.teamId)
    return own.length === 1 && enemy.length === 1
      ? [{ role, ownId: own[0].participantId, enemyId: enemy[0].participantId }]
      : []
  })

  return REVIEW_LANE_DIFF_MINUTES.flatMap((minute) => {
    const target = minute * 60_000
    if (target > meta.gameDuration * 1000) return []
    const frame = match.frames.reduce<(typeof match.frames)[number] | null>(
      (nearest, candidate) =>
        Math.abs(candidate.timestamp - target) <= REVIEW_SNAPSHOT_TOLERANCE_MS &&
        (!nearest || Math.abs(candidate.timestamp - target) < Math.abs(nearest.timestamp - target))
          ? candidate
          : nearest,
      null
    )
    if (!frame) return []

    const gold = new Map(frame.participants.map((entry) => [entry.participantId, entry.gold]))
    const roles = pairs.flatMap(({ role, ownId, enemyId }) => {
      const own = gold.get(ownId)
      const enemy = gold.get(enemyId)
      return own != null && enemy != null ? [{ role, diff: own - enemy }] : []
    })
    return roles.length ? [{ minute, roles }] : []
  })
}
