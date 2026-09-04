import type {
  DetailedGameEvent,
  DetailedTimelineFrame,
  SgpGameDetailsLol,
  SgpGameSummaryLol,
  SgpParticipantLol
} from '@shared/types/sgp/match-history'

import type {
  ReviewEvent,
  ReviewFrame,
  ReviewMatch,
  ReviewMoment,
  ReviewParseResult,
  ReviewParticipant,
  ReviewParticipantFrame,
  ReviewPoint,
  ReviewPosition,
  ReviewSnapshot
} from './types'

// [lolps] 时间均为服务端毫秒。只使用接近整点的实际快照，不插值。
export const REVIEW_SNAPSHOT_TOLERANCE_MS = 10_000
export const REVIEW_MAX_FRAME_GAP_MS = 75_000
export const REVIEW_ALLOWED_QUEUES = [420, 440, 400, 430, 490] as const

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const nonnegative = (value: unknown): number | null => (finite(value) && value >= 0 ? value : null)
const validId = (value: unknown): value is number =>
  finite(value) && Number.isInteger(value) && value > 0
const team = (value: unknown): 100 | 200 | null => (value === 100 || value === 200 ? value : null)

export function normalizeReviewPosition(value: string): ReviewPosition {
  switch (String(value).toUpperCase()) {
    case 'TOP':
      return 'TOP'
    case 'JUNGLE':
      return 'JUNGLE'
    case 'MID':
    case 'MIDDLE':
      return 'MIDDLE'
    case 'ADC':
    case 'BOTTOM':
      return 'BOTTOM'
    case 'SUPPORT':
    case 'UTILITY':
      return 'UTILITY'
    default:
      return 'UNKNOWN'
  }
}

export function getReviewSummaryEligibility(
  summary: SgpGameSummaryLol,
  puuid: string
): { ok: true; participant: SgpParticipantLol } | { ok: false; reason: string } {
  const game = summary?.json
  if (!game || !validId(game.gameId)) return { ok: false, reason: '对局摘要标识无效' }
  if (!Array.isArray(game.participants)) return { ok: false, reason: '摘要缺少玩家身份信息' }
  if (
    game.gameMode !== 'CLASSIC' ||
    game.mapId !== 11 ||
    !(REVIEW_ALLOWED_QUEUES as readonly number[]).includes(game.queueId)
  ) {
    return { ok: false, reason: '仅支持召唤师峡谷常规匹配、单双排和灵活排位' }
  }
  if (
    !finite(game.gameDuration) ||
    game.gameDuration < 300 ||
    /abort|remake/i.test(game.endOfGameResult || '') ||
    game.participants.some((p) => p?.gameEndedInEarlySurrender)
  ) {
    return { ok: false, reason: '重开、提前结束或不足 5 分钟的对局不纳入复盘' }
  }
  const participants = game.participants
  if (
    !Array.isArray(participants) ||
    participants.length !== 10 ||
    participants.some(
      (p) =>
        !p ||
        !validId(p.participantId) ||
        typeof p.puuid !== 'string' ||
        !p.puuid ||
        !team(p.teamId) ||
        !validId(p.championId)
    ) ||
    new Set(participants.map((p) => p.participantId)).size !== 10 ||
    new Set(participants.map((p) => p.puuid)).size !== 10 ||
    participants.filter((p) => p.teamId === 100).length !== 5 ||
    participants.filter((p) => p.teamId === 200).length !== 5
  ) {
    return { ok: false, reason: '摘要缺少完整且唯一的双方 5 人身份信息' }
  }
  const participant = participants.find((p) => p.puuid === puuid)
  if (!participant || typeof participant.win !== 'boolean') {
    return { ok: false, reason: '未找到当前玩家或胜负信息缺失' }
  }
  return { ok: true, participant }
}

function readPosition(value: unknown): ReviewPoint | null {
  if (!value || typeof value !== 'object') return null
  const { x, y } = value as { x?: unknown; y?: unknown }
  return finite(x) &&
    finite(y) &&
    x >= 0 &&
    y >= 0 &&
    x <= 15_000 &&
    y <= 15_000 &&
    (x > 0 || y > 0)
    ? { x, y }
    : null
}

function diff(a: number | null | undefined, b: number | null | undefined): number | null {
  return a != null && b != null ? a - b : null
}

function readFrame(
  raw: DetailedTimelineFrame,
  participants: ReviewParticipant[],
  self: ReviewParticipant,
  opponentId: number | null
): ReviewFrame {
  const parsed: ReviewParticipantFrame[] = participants.map((participant) => {
    const p = raw.participantFrames?.[String(participant.participantId)]
    const valid = p?.participantId === participant.participantId ? p : undefined
    const cs = nonnegative(valid?.minionsKilled)
    const jungleCs = nonnegative(valid?.jungleMinionsKilled)
    const health = nonnegative(valid?.championStats?.health)
    return {
      participantId: participant.participantId,
      gold: nonnegative(valid?.totalGold),
      cs: cs !== null && jungleCs !== null ? cs + jungleCs : null,
      position: readPosition(valid?.position),
      level: nonnegative(valid?.level),
      alive: health === null ? null : health > 0
    }
  })
  const own = parsed.find((p) => p.participantId === self.participantId)
  const opponent = parsed.find((p) => p.participantId === opponentId)
  const allGold = parsed.every((p) => p.gold !== null)
  const participantTeams = new Map(participants.map((p) => [p.participantId, p.teamId]))
  return {
    timestamp: raw.timestamp,
    participants: parsed,
    personalGoldDiff: diff(own?.gold, opponent?.gold),
    personalCsDiff: diff(own?.cs, opponent?.cs),
    teamGoldDiff: allGold
      ? parsed.reduce(
          (total, p) =>
            total + p.gold! * (participantTeams.get(p.participantId) === self.teamId ? 1 : -1),
          0
        )
      : null
  }
}

function readEvents(
  rawFrames: DetailedTimelineFrame[],
  participantTeams: Map<number, 100 | 200>,
  durationMs: number
): ReviewEvent[] {
  const found = new Map<string, ReviewEvent>()
  const known = (id: number): number | null => (participantTeams.has(id) ? id : null)
  for (const raw of rawFrames) {
    for (const event of Array.isArray(raw?.events) ? raw.events : []) {
      if (
        !event ||
        !finite(event.timestamp) ||
        event.timestamp < 0 ||
        event.timestamp > durationMs + 1000
      )
        continue
      if (!['CHAMPION_KILL', 'BUILDING_KILL', 'ELITE_MONSTER_KILL'].includes(event.type)) continue
      const selected = event as Extract<
        DetailedGameEvent,
        { type: 'CHAMPION_KILL' | 'BUILDING_KILL' | 'ELITE_MONSTER_KILL' }
      >
      const killerId = known(selected.killerId)
      let receiverTeam = killerId === null ? null : (participantTeams.get(killerId) ?? null)
      if (selected.type === 'BUILDING_KILL') {
        // [lolps] 建筑事件 teamId 是被摧毁建筑所属队伍，不能当作获益队伍。
        const buildingTeam = team(selected.teamId)
        receiverTeam = buildingTeam === null ? receiverTeam : buildingTeam === 100 ? 200 : 100
      } else if (selected.type === 'ELITE_MONSTER_KILL') {
        const declaredTeam = team(selected.killerTeamId)
        if (declaredTeam !== null && receiverTeam !== null && declaredTeam !== receiverTeam) {
          receiverTeam = null
        } else {
          receiverTeam ??= declaredTeam
        }
      }
      const parsed: ReviewEvent = {
        id: '',
        timestamp: selected.timestamp,
        type:
          selected.type === 'CHAMPION_KILL'
            ? 'kill'
            : selected.type === 'BUILDING_KILL'
              ? 'building'
              : 'monster',
        killerId,
        victimId: selected.type === 'CHAMPION_KILL' ? known(selected.victimId) : null,
        assistingParticipantIds: [
          ...new Set(
            Array.isArray(selected.assistingParticipantIds) ? selected.assistingParticipantIds : []
          )
        ]
          .filter((id) => known(id) !== null)
          .sort((a, b) => a - b),
        teamId: receiverTeam,
        position: readPosition(selected.position),
        shutdownBounty:
          selected.type === 'CHAMPION_KILL' ? nonnegative(selected.shutdownBounty) : null,
        buildingType:
          selected.type === 'BUILDING_KILL' && typeof selected.buildingType === 'string'
            ? selected.buildingType
            : null,
        laneType:
          selected.type === 'BUILDING_KILL' && typeof selected.laneType === 'string'
            ? selected.laneType
            : null,
        monsterType:
          selected.type === 'ELITE_MONSTER_KILL' && typeof selected.monsterType === 'string'
            ? selected.monsterType
            : null,
        monsterSubType:
          selected.type === 'ELITE_MONSTER_KILL' && typeof selected.monsterSubType === 'string'
            ? selected.monsterSubType
            : null
      }
      const key = JSON.stringify(parsed)
      if (!found.has(key)) {
        parsed.id = `event-${found.size}-${selected.timestamp}`
        found.set(key, parsed)
      }
    }
  }
  return [...found.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
}

function readSnapshots(frames: ReviewFrame[], durationMs: number): ReviewSnapshot[] {
  return ([10, 15, 20] as const).map((minute) => {
    const target = minute * 60_000
    const nearest = frames.reduce<ReviewFrame | null>((best, frame) => {
      if (target > durationMs || Math.abs(frame.timestamp - target) > REVIEW_SNAPSHOT_TOLERANCE_MS)
        return best
      return !best || Math.abs(frame.timestamp - target) < Math.abs(best.timestamp - target)
        ? frame
        : best
    }, null)
    return {
      minute,
      timestamp: nearest?.timestamp ?? null,
      personalGoldDiff: nearest?.personalGoldDiff ?? null,
      personalCsDiff: nearest?.personalCsDiff ?? null,
      teamGoldDiff: nearest?.teamGoldDiff ?? null
    }
  })
}

function buildMoments(match: ReviewMatch): ReviewMoment[] {
  const candidates: Array<ReviewMoment & { priority: number }> = []
  const ownId = match.meta.participantId
  const deaths = match.events.filter((event) => event.type === 'kill' && event.victimId === ownId)
  const eventIdsIn = (start: number, end: number) =>
    match.events
      .filter((event) => event.timestamp >= start && event.timestamp <= end)
      .map((event) => event.id)
  for (const death of deaths) {
    if (death.shutdownBounty !== null && death.shutdownBounty > 0) {
      candidates.push({
        id: `shutdown-${death.id}`,
        kind: 'shutdown',
        title: '送出终结赏金',
        description: `这次死亡送出额外 ${death.shutdownBounty} 金币终结赏金，可结合录像检查当时的风险。`,
        start: Math.max(0, death.timestamp - 30_000),
        end: Math.min(match.meta.gameDuration * 1000, death.timestamp + 30_000),
        eventIds: [death.id],
        scope: null,
        before: null,
        after: null,
        priority: 100 + death.shutdownBounty / 100
      })
    }
    const subsequent = deaths.filter(
      (event) => event.timestamp >= death.timestamp && event.timestamp <= death.timestamp + 180_000
    )
    if (subsequent.length >= 2) {
      candidates.push({
        id: `deaths-${death.id}`,
        kind: 'repeated-deaths',
        title: '短时间连续死亡',
        description: `3 分钟内记录到 ${subsequent.length} 次死亡，建议复查复活后的路线和进场时机。`,
        start: Math.max(0, death.timestamp - 30_000),
        end: subsequent[subsequent.length - 1].timestamp,
        eventIds: subsequent.map((event) => event.id),
        scope: null,
        before: null,
        after: null,
        priority: 70 + subsequent.length
      })
    }
    const objectives = match.events.filter(
      (event) =>
        event.type !== 'kill' &&
        event.teamId !== null &&
        event.teamId !== match.meta.teamId &&
        event.timestamp > death.timestamp &&
        event.timestamp <= death.timestamp + 90_000
    )
    if (objectives.length) {
      candidates.push({
        id: `objective-${death.id}`,
        kind: 'death-objective',
        title: '死亡后出现敌方资源事件',
        description: `本次死亡后 90 秒内，记录到敌方 ${objectives.length} 次建筑或大型野怪事件。时间先后仅供复盘，不代表因果。`,
        start: death.timestamp,
        end: objectives[objectives.length - 1].timestamp,
        eventIds: [death.id, ...objectives.map((event) => event.id)],
        scope: null,
        before: null,
        after: null,
        priority: 60 + objectives.length
      })
    }
  }
  for (const scope of ['personal', 'team'] as const) {
    const key = scope === 'personal' ? 'personalGoldDiff' : 'teamGoldDiff'
    const threshold = scope === 'personal' ? 750 : 2000
    for (let i = 0; i < match.frames.length; i++) {
      const start = match.frames[i]
      const before = start[key]
      if (before === null || before <= 0) continue
      for (let j = i + 1; j < match.frames.length; j++) {
        const end = match.frames[j]
        if (end.timestamp - start.timestamp > 300_000) break
        // [lolps] 不跨断档拼接经济拐点；指标缺失也终止该窗口。
        if (
          end.timestamp - match.frames[j - 1].timestamp > REVIEW_MAX_FRAME_GAP_MS ||
          end[key] === null
        )
          break
        if (end.timestamp - start.timestamp < 120_000) continue
        const after = end[key]!
        if (before - after < threshold) continue
        candidates.push({
          id: `swing-${scope}-${start.timestamp}-${end.timestamp}`,
          kind: 'gold-swing',
          title: scope === 'personal' ? '对位经济优势明显缩水' : '团队经济优势明显缩水',
          description: `${scope === 'personal' ? '对位' : '团队'}经济差在这段时间减少 ${Math.round(before - after)} 金币；相关事件供定位录像，不能单独证明原因。`,
          start: start.timestamp,
          end: end.timestamp,
          eventIds: eventIdsIn(start.timestamp, end.timestamp),
          scope,
          before,
          after,
          priority: 40 + Math.min(20, (before - after) / threshold)
        })
      }
    }
  }
  const selected: ReviewMoment[] = []
  candidates.sort(
    (a, b) => b.priority - a.priority || a.start - b.start || a.id.localeCompare(b.id)
  )
  for (const candidate of candidates) {
    if (
      selected.some((other) => {
        const overlap = Math.max(
          0,
          Math.min(other.end, candidate.end) - Math.max(other.start, candidate.start)
        )
        const shorter = Math.min(other.end - other.start, candidate.end - candidate.start)
        return (
          candidate.kind === other.kind &&
          (overlap / Math.max(1, shorter) >= 0.6 ||
            candidate.eventIds.some((id) => other.eventIds.includes(id)))
        )
      })
    )
      continue
    const { priority: _priority, ...moment } = candidate
    selected.push(moment)
    if (selected.length === 5) break
  }
  return selected.sort((a, b) => a.start - b.start)
}

export function parseReviewMatch(
  summary: SgpGameSummaryLol,
  details: SgpGameDetailsLol,
  puuid: string,
  sgpServerId: string
): ReviewParseResult {
  const eligible = getReviewSummaryEligibility(summary, puuid)
  if (!eligible.ok) return eligible
  if (!sgpServerId.trim()) return { ok: false, reason: '缺少对局所属服务器' }
  const raw = details?.json
  if (
    !raw ||
    raw.gameId !== summary.json.gameId ||
    (summary.metadata?.match_id &&
      details.metadata?.match_id &&
      summary.metadata.match_id !== details.metadata.match_id)
  ) {
    return { ok: false, reason: '时间线与摘要的对局标识不一致' }
  }
  if (/abort|remake/i.test(raw.endOfGameResult || ''))
    return { ok: false, reason: '时间线标记为重开或提前结束' }
  if (
    !Array.isArray(raw.participants) ||
    raw.participants.length !== 10 ||
    raw.participants.some((p) => !p || !validId(p.participantId) || typeof p.puuid !== 'string') ||
    new Set(raw.participants.map((p) => p.participantId)).size !== 10 ||
    summary.json.participants.some(
      (p) =>
        !raw.participants.some(
          (other) => other.participantId === p.participantId && other.puuid === p.puuid
        )
    )
  ) {
    return { ok: false, reason: '时间线玩家身份与摘要不一致' }
  }
  if (!Array.isArray(raw.frames) || !raw.frames.length)
    return { ok: false, reason: '服务端尚未提供时间线' }
  const participants: ReviewParticipant[] = summary.json.participants
    .map((p) => ({
      participantId: p.participantId,
      puuid: p.puuid,
      championId: p.championId,
      championName: p.championName || '',
      name: p.riotIdGameName
        ? `${p.riotIdGameName}${p.riotIdTagline ? `#${p.riotIdTagline}` : ''}`
        : p.summonerName || p.championName || '未知玩家',
      teamId: p.teamId as 100 | 200,
      position:
        normalizeReviewPosition(p.teamPosition || '') !== 'UNKNOWN'
          ? normalizeReviewPosition(p.teamPosition)
          : normalizeReviewPosition(p.individualPosition || ''),
      win: p.win
    }))
    .sort((a, b) => a.participantId - b.participantId)
  const self = participants.find((p) => p.puuid === puuid)!
  const ownRoleCount = participants.filter(
    (p) => p.teamId === self.teamId && p.position === self.position
  ).length
  const opponents = participants.filter(
    (p) => p.teamId !== self.teamId && p.position === self.position
  )
  const opponent =
    self.position !== 'UNKNOWN' && ownRoleCount === 1 && opponents.length === 1
      ? opponents[0]
      : null
  const durationMs = summary.json.gameDuration * 1000
  const timestampFrames = new Map<number, DetailedTimelineFrame>()
  let duplicates = 0
  for (const frame of raw.frames) {
    if (
      !frame ||
      !finite(frame.timestamp) ||
      frame.timestamp < 0 ||
      frame.timestamp > durationMs + 1000
    )
      continue
    if (timestampFrames.has(frame.timestamp)) {
      duplicates++
      continue
    }
    timestampFrames.set(frame.timestamp, frame)
  }
  const orderedRawFrames = [...timestampFrames.values()].sort((a, b) => a.timestamp - b.timestamp)
  const frames = orderedRawFrames.map((frame) =>
    readFrame(frame, participants, self, opponent?.participantId ?? null)
  )
  if (
    !frames.some((frame) =>
      frame.participants.some((p) => p.gold !== null || p.cs !== null || p.position !== null)
    )
  ) {
    return { ok: false, reason: '时间线没有可用的玩家快照' }
  }
  const snapshots = readSnapshots(frames, durationMs)
  const expectedFrames = Math.floor(summary.json.gameDuration / 60) + 1
  let validSlots = 0
  let validEventSlots = 0
  for (let minute = 0; minute < expectedFrames; minute++) {
    const closeFrames = frames.filter(
      (frame) => Math.abs(frame.timestamp - minute * 60_000) <= REVIEW_SNAPSHOT_TOLERANCE_MS
    )
    if (
      closeFrames.some((frame) =>
        frame.participants.every((p) => p.gold !== null || p.cs !== null || p.position !== null)
      )
    )
      validSlots++
    if (
      orderedRawFrames.some(
        (frame) =>
          Math.abs(frame.timestamp - minute * 60_000) <= REVIEW_SNAPSHOT_TOLERANCE_MS &&
          Array.isArray(frame.events)
      )
    )
      validEventSlots++
  }
  const warnings: string[] = []
  const events = readEvents(
    raw.frames,
    new Map(participants.map((p) => [p.participantId, p.teamId])),
    durationMs
  )
  const deathCountsMatch = summary.json.participants.every(
    (participant) =>
      nonnegative(participant.deaths) !== null &&
      participant.deaths ===
        events.filter(
          (event) => event.type === 'kill' && event.victimId === participant.participantId
        ).length
  )
  const eventsComplete = validEventSlots === expectedFrames && deathCountsMatch
  if (!opponent) warnings.push('未能唯一确认同位置对手，对位经济与补刀差不计算。')
  if (validSlots < expectedFrames) warnings.push('时间线存在缺失或不完整快照；图表保留断档。')
  if (!eventsComplete)
    warnings.push(
      '事件记录或死亡数量与摘要无法完整核对，次数仅表示已记录事件，不能据此断言没有其他事件。'
    )
  if (duplicates) warnings.push('服务端包含重复时间帧，重复帧已去重。')
  const match: ReviewMatch = {
    meta: {
      gameId: summary.json.gameId,
      sgpServerId,
      puuid,
      gameCreation: summary.json.gameCreation,
      gameDuration: summary.json.gameDuration,
      queueId: summary.json.queueId,
      patch:
        typeof summary.json.gameVersion === 'string'
          ? summary.json.gameVersion.split('.').slice(0, 2).join('.') || '未知'
          : '未知',
      championId: self.championId,
      position: self.position,
      participantId: self.participantId,
      teamId: self.teamId,
      opponentId: opponent?.participantId ?? null,
      opponentChampionId: opponent?.championId ?? null,
      win: self.win
    },
    participants,
    frames,
    events,
    moments: [],
    snapshots,
    quality: {
      expectedFrames,
      missingFrames: expectedFrames - validSlots,
      timelineCoverage: validSlots / expectedFrames,
      validGoldSnapshots: snapshots.filter((snapshot) => snapshot.personalGoldDiff !== null).length,
      validCsSnapshots: snapshots.filter((snapshot) => snapshot.personalCsDiff !== null).length,
      validTeamSnapshots: snapshots.filter((snapshot) => snapshot.teamGoldDiff !== null).length,
      eventCoverage: eventsComplete ? 'complete' : 'partial',
      warnings
    }
  }
  match.moments = buildMoments(match)
  return { ok: true, match }
}
