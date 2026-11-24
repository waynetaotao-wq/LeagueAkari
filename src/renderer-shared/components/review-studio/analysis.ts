import type {
  DetailedGameEvent,
  DetailedTimelineFrame,
  SgpGameDetailsLol,
  SgpGameSummaryLol,
  SgpParticipantLol
} from '@shared/types/sgp/match-history'

import { digestReviewMatch } from './match-digest'
import { type ReviewCoreItemResolver, readReviewDeaths, readReviewEarlyFacts } from './match-facts'
import { type ReviewItemKindResolver, readReviewReport } from './match-report'
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
/**
 * 阵亡多久以内的快照，还可能照到没复活的人。实测 16.23（28 局）最长的一次是阵亡后 59 秒；
 * 后期的复活时间会更长，所以留出余量。
 */
export const REVIEW_CORPSE_MAX_MS = 120_000
/** 阵亡后这么短的时间里不可能已经走完复活时间。 */
export const REVIEW_CERTAIN_DEATH_MS = 5000
export const REVIEW_ALLOWED_QUEUES = [420, 440, 400, 430, 490] as const

export function getReviewPatch(version: unknown): string {
  return typeof version === 'string'
    ? version.trim().split('.').slice(0, 2).join('.') || '未知'
    : '未知'
}

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
    const stats = valid?.championStats
    const health = nonnegative(stats?.health)
    return {
      participantId: participant.participantId,
      gold: nonnegative(valid?.totalGold),
      cs: cs !== null && jungleCs !== null ? cs + jungleCs : null,
      position: readPosition(valid?.position),
      level: nonnegative(valid?.level),
      alive: health === null ? null : health > 0,
      xp: nonnegative(valid?.xp),
      damage: nonnegative(valid?.damageStats?.totalDamageDoneToChampions),
      damageTaken: nonnegative(valid?.damageStats?.totalDamageTaken),
      unspentGold: nonnegative(valid?.currentGold),
      health,
      healthMax: nonnegative(stats?.healthMax),
      attackDamage: nonnegative(stats?.attackDamage),
      abilityPower: nonnegative(stats?.abilityPower),
      armor: finite(stats?.armor) ? stats.armor : null,
      magicResist: finite(stats?.magicResist) ? stats.magicResist : null
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
      if (
        selected.type === 'CHAMPION_KILL' &&
        (known(selected.victimId) === null ||
          (killerId !== null &&
            participantTeams.get(killerId) === participantTeams.get(selected.victimId)))
      )
        continue
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
          .filter(
            (id) =>
              known(id) !== null &&
              id !== killerId &&
              (receiverTeam === null || participantTeams.get(id) === receiverTeam)
          )
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
      // 没有击杀者、击杀方又写的是中立队伍（300）：没有人拿下它，是它自己离场了。
      if (
        selected.type === 'ELITE_MONSTER_KILL' &&
        killerId === null &&
        finite(selected.killerTeamId) &&
        team(selected.killerTeamId) === null &&
        selected.killerTeamId > 0
      )
        parsed.unclaimed = true
      const key = JSON.stringify(parsed)
      if (!found.has(key)) {
        parsed.id = `event-${found.size}-${selected.timestamp}`
        found.set(key, parsed)
      }
    }
  }
  return [...found.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
}

/**
 * 快照里的血量不能单独用来判断死活，要和击杀记录对着看。实测 16.23（28 局、8430 个快照格）：
 * - 阵亡后还没复活的人停在自己的阵亡坐标上一动不动，其中 181 格的血量不是 0（1、12、365……，
 *   像是尸体在回血）。复活走开的人坐标一定变了；离阵亡坐标不到 100 却不完全相同的 4 格里，
 *   有 3 格是复活后走回来的活人。所以只认坐标完全相同的，并且不能是满血：满血站在自己阵亡
 *   的那个点上，只能是在泉水里被杀、又在原地复活的人。
 * - 阵亡后几秒之内的快照，人一定还没复活（一级的复活时间也有十秒左右；实测阵亡后 12 秒内
 *   的 336 格里，已经复活的 3 格都在 9 秒以后，而且都是满血）。这时哪怕坐标差了一点
 *   （实测 1 格：阵亡 2 秒后、离阵亡坐标 38、血量 1）也算阵亡，同样要求不是满血。
 * - 反过来，血量是 0、之前两分钟内却没有阵亡记录的有 1 格（札克的被动）：那不是阵亡。
 *   只有这名玩家的击杀记录和摘要里的死亡数对得上时才这样改判，记录不全就仍按血量算。
 */
function settleAlive(
  frames: ReviewFrame[],
  events: ReviewEvent[],
  /** Participants whose recorded deaths add up to the summary's count. */
  reconciled: ReadonlySet<number>
) {
  const deathsOf = new Map<number, ReviewEvent[]>()
  for (const event of events) {
    if (event.type !== 'kill' || event.victimId === null) continue
    if (!deathsOf.has(event.victimId)) deathsOf.set(event.victimId, [])
    deathsOf.get(event.victimId)!.push(event)
  }
  for (const frame of frames) {
    for (const entry of frame.participants) {
      const health = entry.health
      if (health == null) continue
      const last = deathsOf
        .get(entry.participantId)
        ?.filter((event) => event.timestamp <= frame.timestamp)
        .at(-1)
      if (last && frame.timestamp - last.timestamp <= REVIEW_CORPSE_MAX_MS) {
        const onTheSpot =
          !!last.position &&
          !!entry.position &&
          entry.position.x === last.position.x &&
          entry.position.y === last.position.y
        const fullHealth = entry.healthMax != null && health >= entry.healthMax
        const justDied = frame.timestamp - last.timestamp <= REVIEW_CERTAIN_DEATH_MS
        entry.alive = !(health === 0 || (!fullHealth && (justDied || onTheSpot)))
      } else if (health === 0 && reconciled.has(entry.participantId)) {
        entry.alive = true
      }
    }
  }
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
  // 每次死亡只属于一组，时间窗锚定该组首个死亡，避免重叠链蔓延到整局。
  for (let index = 0; index < deaths.length;) {
    const death = deaths[index]
    const sequence = deaths
      .slice(index)
      .filter((event) => event.timestamp <= death.timestamp + 180_000)
    index += sequence.length
    const bounty = sequence.reduce((sum, event) => sum + (event.shutdownBounty ?? 0), 0)
    const objectives = match.events.filter(
      (event) =>
        event.type !== 'kill' &&
        event.teamId !== null &&
        event.teamId !== match.meta.teamId &&
        sequence.some(
          (ownDeath) =>
            event.timestamp > ownDeath.timestamp && event.timestamp <= ownDeath.timestamp + 90_000
        )
    )
    if (!bounty && sequence.length < 2 && !objectives.length) continue
    const kind =
      bounty > 0 ? 'shutdown' : sequence.length >= 2 ? 'repeated-deaths' : 'death-objective'
    const facts: string[] = []
    if (bounty > 0)
      facts.push(
        sequence.length === 1
          ? `这次死亡送出额外 ${bounty} 金币终结赏金，可结合录像检查当时的风险。`
          : `这组死亡已记录的额外终结赏金合计 ${bounty} 金币。`
      )
    if (sequence.length >= 2)
      facts.push(`3 分钟内记录到 ${sequence.length} 次死亡，建议复查复活后的路线和进场时机。`)
    if (objectives.length)
      facts.push(
        `这些死亡中至少一次死亡后的 90 秒内，记录到敌方 ${objectives.length} 次建筑或大型野怪事件。时间先后仅供复盘，不代表因果。`
      )
    candidates.push({
      id: `${kind}-${death.id}`,
      kind,
      title:
        kind === 'shutdown'
          ? '送出终结赏金'
          : kind === 'repeated-deaths'
            ? '短时间连续死亡'
            : '死亡后出现敌方资源事件',
      description: facts.join(' '),
      start: Math.max(0, death.timestamp - (kind === 'death-objective' ? 0 : 30_000)),
      end: Math.min(
        match.meta.gameDuration * 1000,
        Math.max(
          sequence.at(-1)!.timestamp + (sequence.length === 1 && bounty > 0 ? 30_000 : 0),
          objectives.at(-1)?.timestamp ?? 0
        )
      ),
      eventIds: [...sequence, ...objectives]
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((event) => event.id),
      scope: null,
      before: null,
      after: null,
      priority:
        bounty > 0
          ? 100 + bounty / 100
          : sequence.length >= 2
            ? 70 + sequence.length
            : 60 + objectives.length
    })
  }
  for (const scope of ['personal', 'team'] as const) {
    const key = scope === 'personal' ? 'personalGoldDiff' : 'teamGoldDiff'
    const threshold = scope === 'personal' ? 750 : 2000
    for (let i = 0; i < match.frames.length; i++) {
      const start = match.frames[i]
      const before = start[key]
      if (before === null) continue
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
        const gain = after - before >= threshold && after > 0
        if (!gain && !(before > 0 && before - after >= threshold)) continue
        candidates.push({
          id: `swing-${scope}-${start.timestamp}-${end.timestamp}`,
          kind: gain ? 'gold-gain' : 'gold-swing',
          title: `${scope === 'personal' ? '对位' : '团队'}经济${gain ? '建立或扩大优势' : '优势明显缩水'}`,
          description: `${scope === 'personal' ? '对位' : '团队'}经济差在这段时间${gain ? '增加' : '减少'} ${Math.round(Math.abs(before - after))} 金币；相关事件供定位录像，不能单独证明原因。`,
          start: start.timestamp,
          end: end.timestamp,
          eventIds: eventIdsIn(start.timestamp, end.timestamp),
          scope,
          before,
          after,
          priority: 40 + Math.min(20, Math.abs(before - after) / threshold)
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
          candidate.scope !== null &&
          candidate.kind === other.kind &&
          candidate.scope === other.scope &&
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
  sgpServerId: string,
  options: { coreItem?: ReviewCoreItemResolver; itemKind?: ReviewItemKindResolver } = {}
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
  const conflictingFrames = new Set<number>()
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
      const previous = readFrame(
        timestampFrames.get(frame.timestamp)!,
        participants,
        self,
        opponent?.participantId ?? null
      )
      const current = readFrame(frame, participants, self, opponent?.participantId ?? null)
      if (JSON.stringify(previous.participants) !== JSON.stringify(current.participants)) {
        conflictingFrames.add(frame.timestamp)
      }
      continue
    }
    timestampFrames.set(frame.timestamp, frame)
  }
  for (const timestamp of conflictingFrames) timestampFrames.delete(timestamp)
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
  const deathsReconciled = new Set(
    summary.json.participants
      .filter(
        (participant) =>
          nonnegative(participant.deaths) !== null &&
          participant.deaths ===
            events.filter(
              (event) => event.type === 'kill' && event.victimId === participant.participantId
            ).length
      )
      .map((participant) => participant.participantId)
  )
  const deathCountsMatch = deathsReconciled.size === summary.json.participants.length
  const eventsComplete = validEventSlots === expectedFrames && deathCountsMatch
  if (!opponent) warnings.push('未能唯一确认同位置对手，对位经济与补刀差不计算。')
  if (validSlots < expectedFrames) warnings.push('时间线存在缺失或不完整快照；图表保留断档。')
  if (!eventsComplete)
    warnings.push(
      '事件记录或死亡数量与摘要无法完整核对，次数仅表示已记录事件，不能据此断言没有其他事件。'
    )
  settleAlive(frames, events, deathsReconciled)
  if (duplicates) warnings.push('服务端包含重复时间帧，重复帧已去重。')
  if (conflictingFrames.size)
    warnings.push('同一时刻的玩家快照互相冲突，已留空，避免任选一份产生错误差值。')
  const deaths = readReviewDeaths(events, participants, self)
  const match: ReviewMatch = {
    meta: {
      gameId: summary.json.gameId,
      sgpServerId,
      puuid,
      gameCreation: summary.json.gameCreation,
      gameDuration: summary.json.gameDuration,
      queueId: summary.json.queueId,
      patch: getReviewPatch(summary.json.gameVersion),
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
    },
    deaths,
    early: readReviewEarlyFacts({
      rawFrames: orderedRawFrames,
      frames,
      events,
      deaths,
      participants,
      self,
      durationMs,
      eventsComplete,
      snapshotToleranceMs: REVIEW_SNAPSHOT_TOLERANCE_MS,
      coreItem: options.coreItem
    })
  }
  match.moments = buildMoments(match)
  match.report = readReviewReport({
    summary,
    rawFrames: orderedRawFrames,
    frames,
    events,
    deaths,
    participants,
    self,
    opponentId: opponent?.participantId ?? null,
    durationMs,
    eventsComplete,
    snapshotToleranceMs: REVIEW_SNAPSHOT_TOLERANCE_MS,
    itemKind: options.itemKind
  })
  match.digest = digestReviewMatch(match)
  return { ok: true, match }
}
