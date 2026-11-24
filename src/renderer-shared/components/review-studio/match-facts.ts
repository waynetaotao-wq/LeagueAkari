import { classifyLaneCorridor } from '@renderer-shared/components/ongoing-game-panel/widgets/player-info-card/midlane-research/analysis'
import type { DetailedGameEvent, DetailedTimelineFrame } from '@shared/types/sgp/match-history'

import type {
  ReviewDeath,
  ReviewDeathSource,
  ReviewEarlyFacts,
  ReviewEvent,
  ReviewFrame,
  ReviewParticipant,
  ReviewParticipantFrame
} from './types'

// [lolps] 跨局规律用的单局事实。时间窗与物品口径是展示规则；时间线无法证明的数值保持 null。
export const REVIEW_EARLY_WINDOW_MS = 14 * 60_000
export const REVIEW_FIRST_SHOP_AFTER_MS = 2 * 60_000
/** 实测 16.22 物品库：峡谷成装绝大多数在 2200 以上，散件与鞋子均低于此值。 */
export const REVIEW_CORE_ITEM_MIN_TOTAL_PRICE = 2200
/**
 * 例外是「灵魂窃取者」这样的低价成装（1500）：由散件合成，自己不再往上合成。服务器自己的
 * 成装清单（challenges.legendaryItemUsed）也列了它（实测 16.23）。辅助的任务装（400）和
 * 不带「鞋」分类的升级鞋（1100）都低于这个数，不会被算进来。
 */
export const REVIEW_FINAL_ITEM_MIN_TOTAL_PRICE = 1500

const TEN_MINUTES_MS = 10 * 60_000
const FIFTEEN_MINUTES_MS = 15 * 60_000
/** 实测 WARD_PLACED 中 UNDEFINED 约占四成，不属于玩家主动放置的视野道具。 */
const VISION_WARD_TYPES = new Set(['YELLOW_TRINKET', 'SIGHT_WARD', 'CONTROL_WARD', 'BLUE_TRINKET'])
const OWN_LANES: Partial<Record<ReviewParticipant['position'], string>> = {
  TOP: 'TOP_LANE',
  MIDDLE: 'MID_LANE',
  BOTTOM: 'BOT_LANE',
  UTILITY: 'BOT_LANE'
}

/** true = completed item, false = anything else, null = the item catalogue cannot tell. */
export type ReviewCoreItemResolver = (itemId: number) => boolean | null

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const validId = (value: unknown): value is number =>
  finite(value) && Number.isInteger(value) && value > 0

/**
 * A completed item is built from components and is not footwear; it either costs a full item's
 * price, or it is a cheaper one that nothing else is built from.
 */
export function isReviewCoreItem(item: unknown): boolean | null {
  if (!item || typeof item !== 'object') return null
  const { priceTotal, from, to, categories } = item as {
    priceTotal?: unknown
    from?: unknown
    to?: unknown
    categories?: unknown
  }
  if (!finite(priceTotal) || !Array.isArray(from) || !Array.isArray(categories)) return null
  if (!from.length || categories.includes('Boots')) return false
  return (
    priceTotal >= REVIEW_CORE_ITEM_MIN_TOTAL_PRICE ||
    (priceTotal >= REVIEW_FINAL_ITEM_MIN_TOTAL_PRICE && Array.isArray(to) && to.length === 0)
  )
}

export function readReviewDeaths(
  events: ReviewEvent[],
  participants: ReviewParticipant[],
  self: Pick<ReviewParticipant, 'participantId' | 'teamId'>
): ReviewDeath[] {
  const enemies = new Map(
    participants
      .filter((participant) => participant.teamId !== self.teamId)
      .map((participant) => [participant.participantId, participant])
  )
  const source = (id: number | null): ReviewDeathSource | null => {
    const enemy = id === null ? undefined : enemies.get(id)
    return enemy ? { championId: enemy.championId, role: enemy.position } : null
  }
  return events
    .filter((event) => event.type === 'kill' && event.victimId === self.participantId)
    .map((event) => ({
      timestamp: event.timestamp,
      point: event.position ? { x: event.position.x, y: event.position.y } : null,
      killer: source(event.killerId),
      assists: event.assistingParticipantIds
        .map(source)
        .filter((value): value is ReviewDeathSource => value !== null),
      shutdownBounty: event.shutdownBounty
    }))
}

interface OwnTimeline {
  /** Every purchase event, including ones undone a moment later: proof of standing at the shop. */
  shopVisits: number[]
  /** Purchases still held after applying undo events. */
  purchases: Array<{ timestamp: number; itemId: number }>
  wards: Array<{ timestamp: number; wardType: string }>
  plates: Array<{ timestamp: number; laneType: string; teamId: unknown }>
}

function readOwnTimeline(
  rawFrames: DetailedTimelineFrame[],
  participantId: number,
  durationMs: number
): OwnTimeline {
  const result: OwnTimeline = { shopVisits: [], purchases: [], wards: [], plates: [] }
  const ordered = rawFrames
    .flatMap((frame) => (Array.isArray(frame?.events) ? frame.events : []))
    .filter(
      (event): event is DetailedGameEvent =>
        !!event &&
        finite(event.timestamp) &&
        event.timestamp >= 0 &&
        event.timestamp <= durationMs + 1000
    )
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.timestamp - b.event.timestamp || a.index - b.index)
  for (const { event } of ordered) {
    if (event.type === 'ITEM_PURCHASED') {
      if (event.participantId !== participantId || !validId(event.itemId)) continue
      result.shopVisits.push(event.timestamp)
      result.purchases.push({ timestamp: event.timestamp, itemId: event.itemId })
    } else if (event.type === 'ITEM_UNDO') {
      // 实测：撤销购买为 beforeId=物品、afterId=0；撤销出售则相反，不影响已购列表。
      if (event.participantId !== participantId || !validId(event.beforeId) || event.afterId !== 0)
        continue
      for (let index = result.purchases.length - 1; index >= 0; index--) {
        if (result.purchases[index].itemId !== event.beforeId) continue
        result.purchases.splice(index, 1)
        break
      }
    } else if (event.type === 'WARD_PLACED') {
      if (event.creatorId === participantId && typeof event.wardType === 'string')
        result.wards.push({ timestamp: event.timestamp, wardType: event.wardType })
    } else if (event.type === 'TURRET_PLATE_DESTROYED') {
      if (typeof event.laneType === 'string')
        result.plates.push({
          timestamp: event.timestamp,
          laneType: event.laneType,
          teamId: event.teamId
        })
    }
  }
  return result
}

function nearestFrame(frames: ReviewFrame[], target: number, toleranceMs: number) {
  let best: ReviewFrame | null = null
  for (const frame of frames) {
    const distance = Math.abs(frame.timestamp - target)
    if (distance > toleranceMs) continue
    if (!best || distance < Math.abs(best.timestamp - target)) best = frame
  }
  return best
}

/** Counts separate visits to a side lane from the 2–14 minute snapshots; short trips can be missed. */
function countRoams(
  frames: ReviewFrame[],
  participantId: number,
  toleranceMs: number
): number | null {
  const samples: ReviewParticipantFrame[] = []
  for (let minute = 2; minute <= 14; minute++) {
    const own = nearestFrame(frames, minute * 60_000, toleranceMs)?.participants.find(
      (participant) => participant.participantId === participantId
    )
    // 缺任何一帧本人坐标就不能把这一局当作完整观察窗口。
    if (!own?.position) return null
    samples.push(own)
  }
  let roams = 0
  let previous: 'top' | 'bot' | null = null
  for (const own of samples) {
    const side = own.alive === false ? null : classifyLaneCorridor(own.position!.x, own.position!.y)
    if (side && side !== previous) roams++
    previous = side
  }
  return roams
}

export function readReviewEarlyFacts(input: {
  /** Timeline frames already de-duplicated by timestamp. */
  rawFrames: DetailedTimelineFrame[]
  frames: ReviewFrame[]
  events: ReviewEvent[]
  deaths: ReviewDeath[]
  participants: ReviewParticipant[]
  self: ReviewParticipant
  durationMs: number
  /** Every minute carries an event list and death counts reconcile with the summary. */
  eventsComplete: boolean
  snapshotToleranceMs: number
  coreItem?: ReviewCoreItemResolver
}): ReviewEarlyFacts {
  const { self, durationMs, deaths, eventsComplete } = input
  // 事件不完整时，次数只是下限；宁可留空也不低估。
  const countable = (windowMs: number) => eventsComplete && durationMs >= windowMs
  const own = readOwnTimeline(input.rawFrames, self.participantId, durationMs)
  const ownAtTen =
    durationMs >= TEN_MINUTES_MS
      ? nearestFrame(input.frames, TEN_MINUTES_MS, input.snapshotToleranceMs)?.participants.find(
          (participant) => participant.participantId === self.participantId
        )
      : undefined
  const earlyDeaths = deaths.filter((death) => death.timestamp < REVIEW_EARLY_WINDOW_MS)
  const enemyJunglers = input.participants.filter(
    (participant) => participant.teamId !== self.teamId && participant.position === 'JUNGLE'
  )

  let firstCoreItem: { timestamp: number; itemId: number } | null = null
  if (eventsComplete && input.coreItem) {
    for (const purchase of own.purchases) {
      const core = input.coreItem(purchase.itemId)
      // 物品库认不出某件装备时，无法确定它是不是首件成装，整项留空而不是往后顺延。
      if (core === null) break
      if (!core) continue
      firstCoreItem = purchase
      break
    }
  }

  const lane = OWN_LANES[self.position]
  const lanePlates = own.plates.filter(
    (plate) => plate.laneType === lane && plate.timestamp < REVIEW_EARLY_WINDOW_MS
  )
  // 实测镀层事件的 teamId 是防御塔所属队伍（与坐标一致）；出现其它值时不猜归属。
  const platesKnown =
    lane !== undefined &&
    countable(REVIEW_EARLY_WINDOW_MS) &&
    lanePlates.every((plate) => plate.teamId === 100 || plate.teamId === 200)

  return {
    cs10: ownAtTen?.cs ?? null,
    deathsBefore10: countable(TEN_MINUTES_MS)
      ? deaths.filter((death) => death.timestamp < TEN_MINUTES_MS).length
      : null,
    soloDeathsBefore14: countable(REVIEW_EARLY_WINDOW_MS)
      ? earlyDeaths.filter((death) => death.killer !== null && death.assists.length === 0).length
      : null,
    jungleDeathsBefore14:
      countable(REVIEW_EARLY_WINDOW_MS) && enemyJunglers.length === 1
        ? earlyDeaths.filter(
            (death) =>
              death.killer?.role === 'JUNGLE' ||
              death.assists.some((assist) => assist.role === 'JUNGLE')
          ).length
        : null,
    takedownsBefore14: countable(REVIEW_EARLY_WINDOW_MS)
      ? input.events.filter(
          (event) =>
            event.type === 'kill' &&
            event.timestamp < REVIEW_EARLY_WINDOW_MS &&
            (event.killerId === self.participantId ||
              event.assistingParticipantIds.includes(self.participantId))
        ).length
      : null,
    wardsBefore10: countable(TEN_MINUTES_MS)
      ? own.wards.filter(
          (ward) => ward.timestamp < TEN_MINUTES_MS && VISION_WARD_TYPES.has(ward.wardType)
        ).length
      : null,
    controlWardsBefore15: countable(FIFTEEN_MINUTES_MS)
      ? own.wards.filter(
          (ward) => ward.timestamp < FIFTEEN_MINUTES_MS && ward.wardType === 'CONTROL_WARD'
        ).length
      : null,
    firstShopAt: eventsComplete
      ? (own.shopVisits.find((timestamp) => timestamp >= REVIEW_FIRST_SHOP_AFTER_MS) ?? null)
      : null,
    firstCoreItemAt: firstCoreItem?.timestamp ?? null,
    firstCoreItemId: firstCoreItem?.itemId ?? null,
    platesTaken: platesKnown
      ? lanePlates.filter((plate) => plate.teamId !== self.teamId).length
      : null,
    platesLost: platesKnown
      ? lanePlates.filter((plate) => plate.teamId === self.teamId).length
      : null,
    roamsBefore14:
      self.position === 'MIDDLE' && durationMs >= REVIEW_EARLY_WINDOW_MS
        ? countRoams(input.frames, self.participantId, input.snapshotToleranceMs)
        : null
  }
}
