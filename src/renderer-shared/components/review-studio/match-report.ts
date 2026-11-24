import type {
  DamageDetail,
  DetailedChampionKillEvent,
  DetailedGameEvent,
  DetailedTimelineFrame,
  SgpGameSummaryLol,
  SgpParticipantLol
} from '@shared/types/sgp/match-history'

import { isReviewCoreItem } from './match-facts'
import type {
  ReviewBuild,
  ReviewCheckpoint,
  ReviewCheckpointSide,
  ReviewDamageSlots,
  ReviewDamageSource,
  ReviewDeath,
  ReviewDeathDetail,
  ReviewDeathSource,
  ReviewEvent,
  ReviewFight,
  ReviewFrame,
  ReviewItemKind,
  ReviewKillMark,
  ReviewLevelTiming,
  ReviewObjective,
  ReviewObjectiveBounty,
  ReviewObjectiveKind,
  ReviewOwnDamage,
  ReviewParticipant,
  ReviewParticipantFrame,
  ReviewPlate,
  ReviewPlayerLine,
  ReviewPoint,
  ReviewPosition,
  ReviewReport,
  ReviewRoleAssignment,
  ReviewRunes,
  ReviewShopVisit,
  ReviewTakedown,
  ReviewTeamLine,
  ReviewVision
} from './types'

// [lolps] 单局完整报告：只整理摘要与时间线里记录的事实；时间窗与聚类半径是展示规则。
export const REVIEW_CHECKPOINT_MINUTES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] as const
/** Purchases closer together than this belong to one stop at the shop. */
export const REVIEW_SHOP_VISIT_GAP_MS = 45_000
/** A stop this soon after an own death is the respawn, not a recall. */
export const REVIEW_SHOP_AFTER_DEATH_MS = 90_000
export const REVIEW_OBJECTIVE_AFTER_DEATH_MS = 90_000
export const REVIEW_OBJECTIVE_AFTER_FIGHT_MS = 60_000
/** Snapshots are a minute apart; one further away than this says nothing about an event. */
export const REVIEW_OBJECTIVE_SNAPSHOT_MAX_OFFSET_MS = 45_000
export const REVIEW_FIGHT_GAP_MS = 15_000
export const REVIEW_FIGHT_RADIUS = 4000
export const REVIEW_FIGHT_MIN_KILLS = 2
/** A single kill still counts as a fight when this many champions are credited on it. */
export const REVIEW_FIGHT_MIN_CHAMPIONS = 6
/** Points the leading basic ability needs before a max order is reported. */
export const REVIEW_SKILL_PRIORITY_MIN_RANK = 3

/** Counters copied from the server's challenge tracking when the summary carries them. */
export const REVIEW_CHALLENGE_KEYS = [
  'soloKills',
  'quickSoloKills',
  'outnumberedKills',
  'killsNearEnemyTurret',
  'killsUnderOwnTurret',
  'skillshotsHit',
  'skillshotsDodged',
  'dodgeSkillShotsSmallWindow',
  'landSkillShotsEarlyGame',
  'enemyChampionImmobilizations',
  'immobilizeAndKillWithAlly',
  'pickKillWithAlly',
  'saveAllyFromDeath',
  'survivedSingleDigitHpCount',
  'tookLargeDamageSurvived',
  'laneMinionsFirst10Minutes',
  'jungleCsBefore10Minutes',
  'maxCsAdvantageOnLaneOpponent',
  'maxLevelLeadLaneOpponent',
  'turretPlatesTaken',
  'bountyGold',
  'controlWardsPlaced',
  'stealthWardsPlaced',
  'wardTakedowns',
  'wardTakedownsBefore20M',
  'visionScoreAdvantageLaneOpponent',
  'enemyJungleMonsterKills',
  'alliedJungleMonsterKills',
  'scuttleCrabKills',
  'buffsStolen',
  'epicMonsterSteals',
  'abilityUses',
  'unseenRecalls'
] as const

/**
 * 只给 AI 教练的资料用的另外几项官方计数；「完整数据」页和存档里的摘要数字不含它们。
 * 只收名字说得清、并且拿 280 个视角的取值看不出矛盾的。实测后没收的：
 * - maxKillDeficit：只有赢的一方才不为 0，不是字面上的「最大人头落后」；
 * - moreEnemyJungleThanOpponent：从不为正；
 * - earlyLaningPhaseGoldExpAdvantage / laningPhaseGoldExpAdvantage：是 1 的都确实经济经验双领先，
 *   但双领先的一百来个视角里只有三十个左右是 1，门槛不明，写出来的 0 会被读成「没有领先」；
 * - takedownsFirstXMinutes：不知道 X 是几；
 * - multikills、effectiveHealAndShielding：与摘要里已有的数重复。
 */
export const REVIEW_EXTRA_CHALLENGE_KEYS = [
  'killsOnOtherLanesEarlyJungleAsLaner',
  'teleportTakedowns',
  'multikillsAfterAggressiveFlash',
  'quickCleanse',
  'controlWardTimeCoverageInRiverOrEnemyHalf',
  'wardsGuarded',
  'survivedThreeImmobilizesInFight',
  'knockEnemyIntoTeamAndKill',
  'initialBuffCount',
  'initialCrabCount',
  'killsOnLanersEarlyJungleAsJungler',
  'junglerKillsEarlyJungle',
  'epicMonsterKillsWithin30SecondsOfSpawn',
  'epicMonsterKillsNearEnemyJungler',
  'completeSupportQuestInTime'
] as const

/** Ping counters of the match summary; the three that are always zero are left out. */
export const REVIEW_PING_KEYS = [
  'enemyMissingPings',
  'onMyWayPings',
  'assistMePings',
  'dangerPings',
  'getBackPings',
  'retreatPings',
  'allInPings',
  'pushPings',
  'commandPings',
  'enemyVisionPings',
  'needVisionPings'
] as const

/** Ignite's name in the damage lists of a kill record. */
const IGNITE_SPELL_NAME = 'summonerdot'

/** null = the item catalogue is unavailable or does not know the item. */
export type ReviewItemKindResolver = (itemId: number) => ReviewItemKind | null

/**
 * 实测 16.23：这四类守卫的放置数、清除数与摘要的 wardsPlaced / wardsKilled 在 280 个视角里逐一相等；
 * UNDEFINED、TEEMO_MUSHROOM 不计入。
 */
const VISION_WARD_TYPES = new Set(['YELLOW_TRINKET', 'SIGHT_WARD', 'CONTROL_WARD', 'BLUE_TRINKET'])
/**
 * Ability slots as they appear in kill records. 实测：0-3 为 QWER，4 / 5 为两个召唤师技能
 * （summonerdot、summonersmite…），63 为被动；其余槽位（装备主动、符文、无名伤害）不细分。
 */
const SLOT_KEYS: Record<number, keyof ReviewDamageSlots> = {
  63: 'passive',
  0: 'q',
  1: 'w',
  2: 'e',
  3: 'r',
  4: 'summoner',
  5: 'summoner'
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const amount = (value: unknown): number | null => (finite(value) && value >= 0 ? value : null)
const validId = (value: unknown): value is number =>
  finite(value) && Number.isInteger(value) && value > 0
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)
const share = (value: number | null, total: number | null): number | null =>
  value !== null && total !== null && total > 0 ? value / total : null
const distance = (a: ReviewPoint, b: ReviewPoint) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Classifies a catalogue entry. Completed items follow the same rule as the first-item
 * measurement (`isReviewCoreItem`).
 */
export function classifyReviewItem(item: unknown): ReviewItemKind | null {
  if (!item || typeof item !== 'object') return null
  const { priceTotal, from, to, categories } = item as {
    priceTotal?: unknown
    from?: unknown
    to?: unknown
    categories?: unknown
  }
  if (!finite(priceTotal) || !Array.isArray(from) || !Array.isArray(categories)) return null
  if (categories.includes('Trinket')) return 'trinket'
  if (categories.includes('Consumable')) return 'consumable'
  // The plain pair of boots is a component of every upgraded pair.
  if (categories.includes('Boots')) return from.length > 0 ? 'boots' : 'component'
  if (isReviewCoreItem(item)) return 'core'
  if (Array.isArray(to) && to.length > 0) return 'component'
  if (from.length > 0) return 'component'
  return priceTotal <= 500 ? 'starter' : 'other'
}

function readRunes(participant: SgpParticipantLol): ReviewRunes | null {
  const styles = participant.perks?.styles
  if (!Array.isArray(styles) || !styles.length) return null
  const primary = styles.find((style) => style?.description === 'primaryStyle') ?? styles[0]
  const secondary = styles.find((style) => style !== primary) ?? null
  const selectionsOf = (style: typeof primary | null) =>
    (Array.isArray(style?.selections) ? style.selections : []).filter((selection) =>
      validId(selection?.perk)
    )
  const selections = [...selectionsOf(primary), ...selectionsOf(secondary)]
  const stat = participant.perks?.statPerks
  return {
    primaryStyle: validId(primary?.style) ? primary.style : null,
    subStyle: validId(secondary?.style) ? secondary.style : null,
    perks: selections.map((selection) => selection.perk),
    primaryCount: selectionsOf(primary).length,
    // 三个数分别是什么，由客户端里这颗符文自己的结算说明决定；这里只照抄。
    stats: selections.map((selection) =>
      [selection.var1, selection.var2, selection.var3].map((value) => (finite(value) ? value : 0))
    ),
    shards: [stat?.offense, stat?.flex, stat?.defense].filter(validId)
  }
}

const ROLE_NAMES: Record<string, Exclude<ReviewPosition, 'UNKNOWN'>> = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MIDDLE',
  BOTTOM: 'BOTTOM',
  UTILITY: 'UTILITY'
}

/**
 * 实测 16.23（280 个视角）：selectedRolePreferences 形如「实际位置.标记.第一选择.第二选择」，
 * 标记 PRIMARY / SECONDARY 时实际位置恰好是第一 / 第二选择，AUTOFILL 时两者都不是，
 * FILL_PRIMARY 时第一选择是 FILL。形状对不上就当作未知，不猜。
 */
function readAssignment(
  participant: SgpParticipantLol,
  position: ReviewPosition
): ReviewRoleAssignment | null {
  const raw = participant.selectedRolePreferences
  if (typeof raw !== 'string' || position === 'UNKNOWN') return null
  const [played, tag, first, second] = raw.split('.')
  if (played !== position) return null
  const choice = (
    {
      PRIMARY: 'primary',
      SECONDARY: 'secondary',
      AUTOFILL: 'autofill',
      FILL_PRIMARY: 'fill'
    } as const
  )[tag]
  if (!choice) return null
  const consistent =
    choice === 'primary'
      ? first === played
      : choice === 'secondary'
        ? second === played && first !== played
        : choice === 'fill'
          ? first === 'FILL'
          : first !== played && second !== played
  if (!consistent) return null
  const preferences = [first, second].flatMap((entry) =>
    entry === 'FILL' ? ['FILL' as const] : ROLE_NAMES[entry] ? [ROLE_NAMES[entry]] : []
  )
  const assigned = ROLE_NAMES[String(participant.positionAssignedByMatchmaking)] ?? null
  return {
    choice,
    preferences,
    assigned: assigned !== null && assigned !== position ? assigned : null
  }
}

function readPings(participant: SgpParticipantLol): Record<string, number> | null {
  const pings: Record<string, number> = {}
  for (const key of REVIEW_PING_KEYS) {
    const value = amount(participant[key])
    if (value !== null) pings[key] = value
  }
  return Object.keys(pings).length ? pings : null
}

function readChallenges(participant: SgpParticipantLol): Record<string, number> | null {
  const source = participant.challenges
  if (!source || typeof source !== 'object') return null
  const selected: Record<string, number> = {}
  for (const key of [...REVIEW_CHALLENGE_KEYS, ...REVIEW_EXTRA_CHALLENGE_KEYS]) {
    const value = source[key]
    if (finite(value)) selected[key] = value
  }
  return selected
}

function readPlayers(summary: SgpGameSummaryLol, participants: ReviewParticipant[]) {
  const raw = new Map(summary.json.participants.map((p) => [p.participantId, p]))
  const lines: ReviewPlayerLine[] = participants.map((participant) => {
    const p = raw.get(participant.participantId)!
    const laneCs = amount(p.totalMinionsKilled)
    const jungleCs = amount(p.neutralMinionsKilled)
    return {
      participantId: participant.participantId,
      teamId: participant.teamId,
      championId: participant.championId,
      position: participant.position,
      kills: amount(p.kills),
      deaths: amount(p.deaths),
      assists: amount(p.assists),
      level: amount(p.champLevel),
      cs: laneCs !== null && jungleCs !== null ? laneCs + jungleCs : null,
      jungleCs,
      gold: amount(p.goldEarned),
      goldSpent: amount(p.goldSpent),
      damage: amount(p.totalDamageDealtToChampions),
      physicalDamage: amount(p.physicalDamageDealtToChampions),
      magicDamage: amount(p.magicDamageDealtToChampions),
      trueDamage: amount(p.trueDamageDealtToChampions),
      damageTaken: amount(p.totalDamageTaken),
      physicalDamageTaken: amount(p.physicalDamageTaken),
      magicDamageTaken: amount(p.magicDamageTaken),
      trueDamageTaken: amount(p.trueDamageTaken),
      damageMitigated: amount(p.damageSelfMitigated),
      objectiveDamage: amount(p.damageDealtToObjectives),
      turretDamage: amount(p.damageDealtToTurrets),
      epicMonsterDamage: amount(p.damageDealtToEpicMonsters),
      healing: amount(p.totalHeal),
      allyHealing: amount(p.totalHealsOnTeammates),
      allyShielding: amount(p.totalDamageShieldedOnTeammates),
      ccSeconds: amount(p.timeCCingOthers),
      visionScore: amount(p.visionScore),
      wardsPlaced: amount(p.wardsPlaced),
      wardsKilled: amount(p.wardsKilled),
      controlWardsBought: amount(p.visionWardsBoughtInGame),
      secondsDead: amount(p.totalTimeSpentDead),
      longestLife: amount(p.longestTimeSpentLiving),
      largestKillingSpree: amount(p.largestKillingSpree),
      largestMultiKill: amount(p.largestMultiKill),
      firstBloodKill: flag(p.firstBloodKill),
      firstBloodAssist: flag(p.firstBloodAssist),
      firstTowerKill: flag(p.firstTowerKill),
      firstTowerAssist: flag(p.firstTowerAssist),
      turretTakedowns: amount(p.turretTakedowns),
      inhibitorTakedowns: amount(p.inhibitorTakedowns),
      dragonKills: amount(p.dragonKills),
      baronKills: amount(p.baronKills),
      objectivesStolen: amount(p.objectivesStolen),
      items: [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].filter(validId),
      trinket: validId(p.item6) ? p.item6 : null,
      roleItem: validId(p.roleBoundItem) ? p.roleBoundItem : null,
      summonerSpells: [p.spell1Id, p.spell2Id].filter(validId),
      casts: {
        q: amount(p.spell1Casts),
        w: amount(p.spell2Casts),
        e: amount(p.spell3Casts),
        r: amount(p.spell4Casts),
        summoner1: amount(p.summoner1Casts),
        summoner2: amount(p.summoner2Casts)
      },
      runes: readRunes(p),
      killParticipation: null,
      damageShare: null,
      damageTakenShare: null,
      goldShare: null,
      challenges: readChallenges(p),
      afk: flag(p.wasAfk),
      pings: readPings(p)
    }
  })
  // A team total exists only when every member reports the number; otherwise shares stay unknown.
  const total = (teamId: number, pick: (line: ReviewPlayerLine) => number | null) => {
    let sum = 0
    for (const line of lines) {
      if (line.teamId !== teamId) continue
      const value = pick(line)
      if (value === null) return null
      sum += value
    }
    return sum
  }
  for (const line of lines) {
    const teamKills = total(line.teamId, (other) => other.kills)
    line.killParticipation =
      line.kills !== null && line.assists !== null
        ? share(line.kills + line.assists, teamKills)
        : null
    line.damageShare = share(
      line.damage,
      total(line.teamId, (other) => other.damage)
    )
    line.damageTakenShare = share(
      line.damageTaken,
      total(line.teamId, (other) => other.damageTaken)
    )
    line.goldShare = share(
      line.gold,
      total(line.teamId, (other) => other.gold)
    )
  }
  return { lines, total }
}

function readTeams(
  summary: SgpGameSummaryLol,
  total: (teamId: number, pick: (line: ReviewPlayerLine) => number | null) => number | null,
  events: ReviewEvent[],
  souls: Map<number, string>
): ReviewTeamLine[] {
  return ([100, 200] as const).map((teamId) => {
    const raw = (Array.isArray(summary.json.teams) ? summary.json.teams : []).find(
      (team) => team?.teamId === teamId
    )
    const objective = (key: keyof NonNullable<typeof raw>['objectives']) =>
      raw?.objectives?.[key] ?? null
    return {
      teamId,
      win: flag(raw?.win),
      kills: total(teamId, (line) => line.kills),
      gold: total(teamId, (line) => line.gold),
      damage: total(teamId, (line) => line.damage),
      towers: amount(objective('tower')?.kills),
      inhibitors: amount(objective('inhibitor')?.kills),
      dragons: amount(objective('dragon')?.kills),
      barons: amount(objective('baron')?.kills),
      heralds: amount(objective('riftHerald')?.kills),
      grubs: amount(objective('horde')?.kills),
      atakhans: amount(objective('atakhan')?.kills),
      firstBlood: flag(objective('champion')?.first),
      firstTower: flag(objective('tower')?.first),
      firstDragon: flag(objective('dragon')?.first),
      firstBaron: flag(objective('baron')?.first),
      bans: (Array.isArray(raw?.bans) ? raw.bans : [])
        .map((ban) => ban?.championId)
        .filter(validId),
      dragonTypes: events
        .filter(
          (event) =>
            event.type === 'monster' && event.monsterType === 'DRAGON' && event.teamId === teamId
        )
        .map((event) => event.monsterSubType || 'DRAGON'),
      soul: souls.get(teamId) ?? null
    }
  })
}

/** Raw timeline events in time order, with events outside the game window dropped. */
function orderEvents(rawFrames: DetailedTimelineFrame[], durationMs: number): DetailedGameEvent[] {
  return rawFrames
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
    .map(({ event }) => event)
}

/**
 * The part of the max order the recorded level-ups settle. One ability outranks another when
 * it holds more points, or when both are maxed and it got there first.
 */
function readSkillPriority(skills: ReviewBuild['skills']): Array<1 | 2 | 3> | null {
  const basics = ([1, 2, 3] as const).map((slot) => {
    const times = skills.filter((skill) => skill.slot === slot).map((skill) => skill.timestamp)
    return { slot, rank: times.length, maxedAt: times.length >= 5 ? times[4] : null }
  })
  const before = (a: (typeof basics)[number], b: (typeof basics)[number]) =>
    a.rank !== b.rank
      ? b.rank - a.rank
      : a.maxedAt !== null && b.maxedAt !== null
        ? a.maxedAt - b.maxedAt
        : 0
  const settled = (a: (typeof basics)[number], b: (typeof basics)[number]) =>
    a.rank > b.rank || (a.maxedAt !== null && b.maxedAt !== null && a.maxedAt !== b.maxedAt)
  const ordered = [...basics].sort((a, b) => before(a, b) || a.slot - b.slot)
  // 一两个技能点说明不了主加顺序：至少点到 3 级才算。
  if (
    ordered[0].rank < REVIEW_SKILL_PRIORITY_MIN_RANK ||
    !settled(ordered[0], ordered[1]) ||
    !settled(ordered[0], ordered[2])
  )
    return null
  return settled(ordered[1], ordered[2])
    ? [ordered[0].slot, ordered[1].slot, ordered[2].slot]
    : [ordered[0].slot]
}

function readBuild(
  ordered: DetailedGameEvent[],
  participantId: number,
  /** Deaths of the same participant, in time order. */
  deaths: ReadonlyArray<{ timestamp: number }>,
  itemKind: ReviewItemKindResolver | undefined
): ReviewBuild {
  const purchases: Array<{ timestamp: number; itemId: number }> = []
  const sales: Array<{ timestamp: number; itemId: number }> = []
  // 买、卖和撤销的时刻。撤销只能在商店里做，所以它说明人还在商店，但它本身不开始一次停留。
  const shopTimes: Array<{ timestamp: number; undo: boolean }> = []
  const skills: ReviewBuild['skills'] = []
  const destroyed: NonNullable<ReviewBuild['destroyed']> = {}
  const removeLast = (list: Array<{ itemId: number }>, itemId: number) => {
    for (let index = list.length - 1; index >= 0; index--) {
      if (list[index].itemId !== itemId) continue
      list.splice(index, 1)
      return
    }
  }
  for (const event of ordered) {
    if (event.type === 'ITEM_PURCHASED') {
      if (event.participantId !== participantId || !validId(event.itemId)) continue
      shopTimes.push({ timestamp: event.timestamp, undo: false })
      purchases.push({ timestamp: event.timestamp, itemId: event.itemId })
    } else if (event.type === 'ITEM_SOLD') {
      if (event.participantId !== participantId || !validId(event.itemId)) continue
      shopTimes.push({ timestamp: event.timestamp, undo: false })
      sales.push({ timestamp: event.timestamp, itemId: event.itemId })
    } else if (event.type === 'ITEM_DESTROYED') {
      // 物品离开物品栏：喝掉、合成进别的装备，或者变成了另一件（升到三阶的鞋、辅助的任务装）。
      if (event.participantId !== participantId || !validId(event.itemId)) continue
      destroyed[event.itemId] = {
        timestamp: event.timestamp,
        count: (destroyed[event.itemId]?.count ?? 0) + 1
      }
    } else if (event.type === 'ITEM_UNDO') {
      if (event.participantId !== participantId) continue
      shopTimes.push({ timestamp: event.timestamp, undo: true })
      // 实测：撤销购买为 beforeId=物品、afterId=0；撤销出售相反。
      if (validId(event.beforeId) && event.afterId === 0) removeLast(purchases, event.beforeId)
      else if (validId(event.afterId) && event.beforeId === 0) removeLast(sales, event.afterId)
    } else if (event.type === 'SKILL_LEVEL_UP') {
      if (
        event.participantId === participantId &&
        event.levelUpType !== 'EVOLVE' &&
        [1, 2, 3, 4].includes(event.skillSlot)
      )
        skills.push({ timestamp: event.timestamp, slot: event.skillSlot as 1 | 2 | 3 | 4 })
    }
  }
  const classified = purchases.map((purchase) => ({
    ...purchase,
    kind: itemKind ? itemKind(purchase.itemId) : null
  }))
  const visits: ReviewShopVisit[] = []
  let lastShopTime = -Infinity
  for (const { timestamp, undo } of shopTimes) {
    // 实测 16.23：有人阵亡后在泉水里卖了又撤销、反复了一分多钟才买下东西；中间那几次撤销
    // 不算的话，两次操作隔了 45 秒以上，同一次停留会被拆成「阵亡后」和「回城」两次。
    if (undo) {
      if (visits.length) lastShopTime = timestamp
      continue
    }
    const lastDeath = deaths.filter((death) => death.timestamp <= timestamp).at(-1)
    // 上一次买东西之后死过一次：哪怕两次购买只隔几十秒，中间也出过门，是另一次停留。
    const diedSince = lastDeath !== undefined && lastDeath.timestamp > lastShopTime
    if (timestamp - lastShopTime > REVIEW_SHOP_VISIT_GAP_MS || diedSince) {
      visits.push({
        timestamp,
        // 只有阵亡后的第一次停留才算「阵亡后」；之后再回来买，是正常回城。
        afterDeath: diedSince && timestamp - lastDeath.timestamp <= REVIEW_SHOP_AFTER_DEATH_MS,
        itemIds: []
      })
    }
    lastShopTime = timestamp
  }
  const visitAt = (timestamp: number) =>
    visits.filter((candidate) => candidate.timestamp <= timestamp).at(-1)
  for (const purchase of purchases) visitAt(purchase.timestamp)?.itemIds.push(purchase.itemId)
  // 一次停留可能只卖不买，也可能买了又全部撤销：卖出的东西记在这次停留上，才分得清是哪一种。
  for (const sale of sales) {
    const visit = visitAt(sale.timestamp)
    if (visit) (visit.soldIds ??= []).push(sale.itemId)
  }
  const boots = classified.find((purchase) => purchase.kind === 'boots')
  return {
    purchases: classified,
    sales,
    coreItems: classified
      .filter((purchase) => purchase.kind === 'core')
      .map(({ timestamp, itemId }) => ({ timestamp, itemId })),
    boots: boots ? { timestamp: boots.timestamp, itemId: boots.itemId } : null,
    destroyed,
    visits,
    skills,
    skillPriority: readSkillPriority(skills)
  }
}

function readLevels(
  ordered: DetailedGameEvent[],
  ownId: number,
  opponentId: number | null
): ReviewLevelTiming[] {
  const own = new Map<number, number>()
  const opponent = new Map<number, number>()
  for (const event of ordered) {
    if (event.type !== 'LEVEL_UP' || !validId(event.level) || event.level < 2 || event.level > 30)
      continue
    const target =
      event.participantId === ownId
        ? own
        : opponentId !== null && event.participantId === opponentId
          ? opponent
          : null
    if (target && !target.has(event.level)) target.set(event.level, event.timestamp)
  }
  return [...new Set([...own.keys(), ...opponent.keys()])]
    .sort((a, b) => a - b)
    .map((level) => ({
      level,
      own: own.get(level) ?? null,
      opponent: opponent.get(level) ?? null
    }))
}

function nearestFrame(frames: ReviewFrame[], target: number, toleranceMs: number) {
  let best: ReviewFrame | null = null
  for (const frame of frames) {
    const offset = Math.abs(frame.timestamp - target)
    if (offset > toleranceMs) continue
    if (!best || offset < Math.abs(best.timestamp - target)) best = frame
  }
  return best
}

const side = (frame: ReviewParticipantFrame | undefined): ReviewCheckpointSide | null =>
  frame
    ? {
        gold: frame.gold,
        cs: frame.cs,
        xp: frame.xp ?? null,
        level: frame.level,
        damage: frame.damage ?? null
      }
    : null
const diff = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b != null ? a - b : null

function readCheckpoints(
  frames: ReviewFrame[],
  ownId: number,
  opponentId: number | null,
  durationMs: number,
  toleranceMs: number
): ReviewCheckpoint[] {
  return REVIEW_CHECKPOINT_MINUTES.filter((minute) => minute * 60_000 <= durationMs).map(
    (minute) => {
      const frame = nearestFrame(frames, minute * 60_000, toleranceMs)
      const own = side(frame?.participants.find((p) => p.participantId === ownId))
      const opponent =
        opponentId === null
          ? null
          : side(frame?.participants.find((p) => p.participantId === opponentId))
      return {
        minute,
        timestamp: frame?.timestamp ?? null,
        own,
        opponent,
        goldDiff: diff(own?.gold, opponent?.gold),
        csDiff: diff(own?.cs, opponent?.cs),
        xpDiff: diff(own?.xp, opponent?.xp),
        levelDiff: diff(own?.level, opponent?.level),
        teamGoldDiff: frame?.teamGoldDiff ?? null
      }
    }
  )
}

function groupDamage(
  details: DamageDetail[] | undefined,
  participants: Map<number, ReviewParticipant>
): ReviewDamageSource[] | null {
  if (!Array.isArray(details)) return null
  const sources = new Map<string, ReviewDamageSource>()
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue
    const champion = validId(detail.participantId) ? participants.get(detail.participantId) : null
    const kind: ReviewDamageSource['kind'] = champion
      ? 'champion'
      : detail.type === 'TOWER'
        ? 'turret'
        : detail.type === 'MINION'
          ? 'minion'
          : detail.type === 'MONSTER'
            ? 'monster'
            : 'other'
    const key = champion ? `champion:${champion.participantId}` : kind
    let source = sources.get(key)
    if (!source) {
      source = {
        kind,
        championId: champion?.championId ?? null,
        role: champion?.position ?? null,
        total: 0,
        physical: 0,
        magic: 0,
        trueDamage: 0,
        slots: { basic: 0, passive: 0, q: 0, w: 0, e: 0, r: 0, summoner: 0, other: 0 }
      }
      sources.set(key, source)
    }
    const physical = amount(detail.physicalDamage) ?? 0
    const magic = amount(detail.magicDamage) ?? 0
    const trueDamage = amount(detail.trueDamage) ?? 0
    const sum = physical + magic + trueDamage
    source.physical += physical
    source.magic += magic
    source.trueDamage += trueDamage
    source.total += sum
    const slot = detail.basic ? 'basic' : (SLOT_KEYS[detail.spellSlot] ?? 'other')
    source.slots[slot] += sum
  }
  return [...sources.values()]
    .filter((source) => source.total > 0)
    .sort((a, b) => b.total - a.total)
}

const damageOf = (detail: DamageDetail) =>
  (amount(detail?.physicalDamage) ?? 0) +
  (amount(detail?.magicDamage) ?? 0) +
  (amount(detail?.trueDamage) ?? 0)

/**
 * 击杀记录带两份伤害清单：普通的一份，和口径更宽的「团战」一份。实测 16.23（1738 次击杀）
 * 两份都在，后者的总量从不小于前者；本人参与的 509 次击杀里，后者记到的本人伤害也从不更少。
 * 所以有宽的那份就用它。
 */
const widerList = (wide: DamageDetail[] | undefined, plain: DamageDetail[] | undefined) =>
  Array.isArray(wide) && wide.length ? wide : Array.isArray(plain) ? plain : null

function readOwnDamage(
  details: DamageDetail[] | null,
  participantId: number
): ReviewOwnDamage | null {
  if (!details) return null
  const own: ReviewOwnDamage = {
    total: 0,
    slots: { basic: 0, passive: 0, q: 0, w: 0, e: 0, r: 0, summoner: 0, other: 0 },
    ignite: 0,
    victimTotal: 0
  }
  for (const detail of details) {
    if (!detail || typeof detail !== 'object') continue
    const sum = damageOf(detail)
    own.victimTotal += sum
    if (detail.participantId !== participantId) continue
    own.total += sum
    own.slots[detail.basic ? 'basic' : (SLOT_KEYS[detail.spellSlot] ?? 'other')] += sum
    if (!detail.basic && detail.spellName === IGNITE_SPELL_NAME) own.ignite += sum
  }
  return own.total > 0 ? own : null
}

const totalDamage = (details: DamageDetail[] | undefined) => {
  if (!Array.isArray(details) || !details.length) return null
  const sum = details.reduce((total, detail) => total + damageOf(detail), 0)
  return sum > 0 ? sum : null
}

function readObjectives(
  events: ReviewEvent[],
  rawBuildings: Map<string, string | null>,
  /** Monster kills whose raw record lists the reviewed player, keyed like `monsterKey`. */
  rawMonsterCredits: Set<string>,
  self: ReviewParticipant,
  deaths: ReviewDeath[],
  frames: ReviewFrame[]
): ReviewObjective[] {
  const kindOf = (event: ReviewEvent): { kind: ReviewObjectiveKind; detail: string | null } => {
    if (event.type === 'building') {
      return event.buildingType === 'INHIBITOR_BUILDING'
        ? { kind: 'inhibitor', detail: null }
        : event.buildingType === 'TOWER_BUILDING'
          ? { kind: 'tower', detail: rawBuildings.get(buildingKey(event)) ?? null }
          : { kind: 'other', detail: event.buildingType }
    }
    switch (event.monsterType) {
      case 'DRAGON':
        return {
          kind: event.monsterSubType === 'ELDER_DRAGON' ? 'elder' : 'dragon',
          detail: event.monsterSubType
        }
      case 'RIFTHERALD':
        return { kind: 'herald', detail: null }
      case 'HORDE':
        return { kind: 'grubs', detail: null }
      case 'BARON_NASHOR':
        return { kind: 'baron', detail: null }
      case 'ATAKHAN':
        return { kind: 'atakhan', detail: event.monsterSubType }
      default:
        return { kind: 'other', detail: event.monsterType }
    }
  }
  return events
    .filter((event) => event.type !== 'kill')
    .map((event) => {
      const lastDeath = deaths.filter((death) => death.timestamp <= event.timestamp).at(-1)
      const sinceDeath =
        lastDeath && event.timestamp - lastDeath.timestamp <= REVIEW_OBJECTIVE_AFTER_DEATH_MS
          ? event.timestamp - lastDeath.timestamp
          : null
      const frame = nearestFrame(frames, event.timestamp, REVIEW_OBJECTIVE_SNAPSHOT_MAX_OFFSET_MS)
      const own = frame?.participants.find((p) => p.participantId === self.participantId)
      // 快照里本人是死的，那个坐标是尸体的，说明不了离目标多远。
      const measurable = !!event.position && !!own?.position && own.alive !== false
      const taken = event.teamId === null ? null : event.teamId === self.teamId
      return {
        timestamp: event.timestamp,
        ...kindOf(event),
        lane: event.laneType,
        own: taken,
        credited:
          event.killerId === self.participantId ||
          event.assistingParticipantIds.includes(self.participantId),
        // 实测 16.23：敌方拿下的史诗野怪，记录的参与者名单里有时也有本人（28 局里 5 次）。
        ...(taken === false && event.type === 'monster' && rawMonsterCredits.has(monsterKey(event))
          ? { contested: true }
          : {}),
        ...(event.unclaimed ? { unclaimed: true } : {}),
        sinceDeath,
        distance: measurable ? Math.round(distance(own!.position!, event.position!)) : null,
        snapshotOffset: measurable ? frame!.timestamp - event.timestamp : null,
        point: event.position ? { x: event.position.x, y: event.position.y } : null
      }
    })
}

const buildingKey = (event: {
  timestamp: number
  position?: { x: number; y: number } | null
  laneType?: string | null
}) =>
  `${event.timestamp}:${event.position?.x ?? ''}:${event.position?.y ?? ''}:${event.laneType ?? ''}`

const monsterKey = (event: { timestamp: number; monsterType?: string | null }) =>
  `${event.timestamp}:${event.monsterType ?? ''}`

interface FightCluster {
  events: ReviewEvent[]
  last: number
}

function clusterKills(kills: ReviewEvent[]): FightCluster[] {
  const clusters: FightCluster[] = []
  for (const kill of kills) {
    let joined: FightCluster | null = null
    for (let index = clusters.length - 1; index >= 0; index--) {
      const cluster = clusters[index]
      if (kill.timestamp - cluster.last > REVIEW_FIGHT_GAP_MS) continue
      const located = cluster.events.filter((event) => event.position)
      if (
        !kill.position ||
        !located.length ||
        located.some((event) => distance(event.position!, kill.position!) <= REVIEW_FIGHT_RADIUS)
      ) {
        joined = cluster
        break
      }
    }
    if (joined) {
      joined.events.push(kill)
      joined.last = kill.timestamp
    } else clusters.push({ events: [kill], last: kill.timestamp })
  }
  return clusters
}

function readFights(
  events: ReviewEvent[],
  participants: Map<number, ReviewParticipant>,
  self: ReviewParticipant,
  objectives: ReviewObjective[]
) {
  const kills = events.filter((event) => event.type === 'kill' && event.victimId !== null)
  const fights: ReviewFight[] = []
  const fightOfDeath = new Map<number, number>()
  for (const cluster of clusterKills(kills)) {
    const credited = new Set<number>()
    for (const event of cluster.events) {
      if (event.killerId !== null) credited.add(event.killerId)
      credited.add(event.victimId!)
      for (const id of event.assistingParticipantIds) credited.add(id)
    }
    if (
      cluster.events.length < REVIEW_FIGHT_MIN_KILLS &&
      credited.size < REVIEW_FIGHT_MIN_CHAMPIONS
    )
      continue
    const teamOf = (id: number) => participants.get(id)?.teamId
    const ownTeamDeaths = cluster.events.filter((event) => teamOf(event.victimId!) === self.teamId)
    const ownDeathIndex = ownTeamDeaths.findIndex((event) => event.victimId === self.participantId)
    const executions = cluster.events.filter((event) => event.killerId === null)
    const allyExecutions = executions.filter((event) => ownTeamDeaths.includes(event)).length
    const enemyExecutions = executions.length - allyExecutions
    const located = cluster.events.filter((event) => event.position)
    const start = cluster.events[0].timestamp
    const end = cluster.last
    const index = fights.length
    for (const event of cluster.events)
      if (event.victimId === self.participantId) fightOfDeath.set(event.timestamp, index)
    fights.push({
      start,
      end,
      killPoints: located.map((event) => ({ x: event.position!.x, y: event.position!.y })),
      point: located.length
        ? {
            x: Math.round(located.reduce((sum, e) => sum + e.position!.x, 0) / located.length),
            y: Math.round(located.reduce((sum, e) => sum + e.position!.y, 0) / located.length)
          }
        : null,
      kills: cluster.events.length - ownTeamDeaths.length,
      deaths: ownTeamDeaths.length,
      ...(enemyExecutions ? { enemyExecutions } : {}),
      ...(allyExecutions ? { allyExecutions } : {}),
      allies: [...credited].filter((id) => teamOf(id) === self.teamId).length,
      enemies: [...credited].filter((id) => teamOf(id) !== self.teamId).length,
      ownKills: cluster.events.filter((event) => event.killerId === self.participantId).length,
      ownAssists: cluster.events.filter((event) =>
        event.assistingParticipantIds.includes(self.participantId)
      ).length,
      ownDeathOrder: ownDeathIndex >= 0 ? ownDeathIndex + 1 : null,
      objectivesAfter: objectives
        .map((objective, objectiveIndex) => ({ objective, objectiveIndex }))
        .filter(
          ({ objective }) =>
            objective.timestamp > end &&
            objective.timestamp <= end + REVIEW_OBJECTIVE_AFTER_FIGHT_MS
        )
        .map(({ objectiveIndex }) => objectiveIndex)
    })
  }
  return { fights, fightOfDeath }
}

export function readReviewReport(input: {
  summary: SgpGameSummaryLol
  /** Timeline frames already de-duplicated by timestamp. */
  rawFrames: DetailedTimelineFrame[]
  frames: ReviewFrame[]
  events: ReviewEvent[]
  deaths: ReviewDeath[]
  participants: ReviewParticipant[]
  self: ReviewParticipant
  opponentId: number | null
  durationMs: number
  /** Every minute carries an event list and death counts reconcile with the summary. */
  eventsComplete: boolean
  snapshotToleranceMs: number
  itemKind?: ReviewItemKindResolver
}): ReviewReport {
  const { self, events, deaths, frames, durationMs } = input
  const participants = new Map(input.participants.map((p) => [p.participantId, p]))
  const ordered = orderEvents(input.rawFrames, durationMs)

  const rawKills = new Map<string, DetailedChampionKillEvent>()
  const rawBuildings = new Map<string, string | null>()
  const souls = new Map<number, string>()
  let riftElement: ReviewReport['riftElement'] = null
  const plates: ReviewPlate[] = []
  const bounties: ReviewObjectiveBounty[] = []
  const killMarks: ReviewKillMark[] = []
  let firstBlood: { timestamp: number; killerId: number } | null = null
  const vision: ReviewVision = { placed: [], cleared: [] }
  const rawMonsterCredits = new Set<string>()
  const levelUps = new Map<number, Array<{ timestamp: number; level: number }>>()
  const ownSide = (teamId: unknown) =>
    teamId === 100 || teamId === 200 ? teamId === self.teamId : null
  for (const event of ordered) {
    if (event.type === 'CHAMPION_KILL') {
      rawKills.set(`${event.timestamp}:${event.victimId}`, event)
    } else if (event.type === 'ELITE_MONSTER_KILL') {
      if (
        Array.isArray(event.assistingParticipantIds) &&
        event.assistingParticipantIds.includes(self.participantId)
      )
        rawMonsterCredits.add(monsterKey(event))
    } else if (event.type === 'LEVEL_UP') {
      if (!validId(event.participantId) || !validId(event.level)) continue
      if (!levelUps.has(event.participantId)) levelUps.set(event.participantId, [])
      levelUps.get(event.participantId)!.push({ timestamp: event.timestamp, level: event.level })
    } else if (event.type === 'BUILDING_KILL') {
      rawBuildings.set(
        buildingKey(event),
        typeof event.towerType === 'string' ? event.towerType : null
      )
    } else if (event.type === 'DRAGON_SOUL_GIVEN') {
      if (typeof event.name !== 'string' || !event.name) continue
      if (event.teamId === 100 || event.teamId === 200) souls.set(event.teamId, event.name)
      // 实测：同名事件先以 teamId 0 出现一次，那是峡谷变成这个元素的时刻；拿到龙魂时再记一次。
      else if (event.teamId === 0 && !riftElement)
        riftElement = { timestamp: event.timestamp, name: event.name }
    } else if (event.type === 'TURRET_PLATE_DESTROYED') {
      // teamId 是这座塔所属的队伍（实测 941 次有击破者的记录里，击破者全在另一队）。
      const turretOwn = ownSide(event.teamId)
      plates.push({
        timestamp: event.timestamp,
        lane: typeof event.laneType === 'string' ? event.laneType : null,
        own: turretOwn === null ? null : !turretOwn,
        byPlayer: event.killerId === self.participantId
      })
    } else if (event.type === 'OBJECTIVE_BOUNTY_PRESTART') {
      // teamId 是可以领赏金的一方（实测 38 次全是当时经济落后的那一队）。
      bounties.push({
        announcedAt: event.timestamp,
        start: finite(event.actualStartTime) ? event.actualStartTime : event.timestamp,
        end: null,
        own: ownSide(event.teamId)
      })
    } else if (event.type === 'OBJECTIVE_BOUNTY_FINISH') {
      const open = bounties.at(-1)
      if (open && open.end === null && open.own === ownSide(event.teamId))
        open.end = event.timestamp
    } else if (event.type === 'CHAMPION_SPECIAL_KILL') {
      if (!validId(event.killerId)) continue
      if (event.killType === 'KILL_FIRST_BLOOD') {
        if (!firstBlood) firstBlood = { timestamp: event.timestamp, killerId: event.killerId }
        continue
      }
      // 实测 16.23：187 个多杀标记、29 个团灭标记，每一个都有同一时刻、同一击杀者的击杀事件。
      const multiKill =
        event.killType === 'KILL_MULTI' &&
        validId(event.multiKillLength) &&
        event.multiKillLength >= 2
          ? event.multiKillLength
          : null
      const ace = event.killType === 'KILL_ACE'
      if (multiKill === null && !ace) continue
      const mark = killMarks.find(
        (entry) => entry.timestamp === event.timestamp && entry.killerId === event.killerId
      )
      if (mark) {
        mark.multiKill = multiKill ?? mark.multiKill
        mark.ace ||= ace
      } else
        killMarks.push({ timestamp: event.timestamp, killerId: event.killerId, multiKill, ace })
    } else if (event.type === 'WARD_PLACED') {
      if (
        event.creatorId === self.participantId &&
        typeof event.wardType === 'string' &&
        VISION_WARD_TYPES.has(event.wardType)
      )
        vision.placed.push({ timestamp: event.timestamp, wardType: event.wardType })
    } else if (event.type === 'WARD_KILL') {
      if (
        event.killerId === self.participantId &&
        typeof event.wardType === 'string' &&
        VISION_WARD_TYPES.has(event.wardType)
      )
        vision.cleared.push({ timestamp: event.timestamp, wardType: event.wardType })
    }
  }

  const { lines, total } = readPlayers(input.summary, input.participants)
  const objectives = readObjectives(events, rawBuildings, rawMonsterCredits, self, deaths, frames)
  const { fights, fightOfDeath } = readFights(events, participants, self, objectives)

  const source = (id: number): ReviewDeathSource | null => {
    const participant = participants.get(id)
    return participant && participant.teamId !== self.teamId
      ? { championId: participant.championId, role: participant.position }
      : null
  }
  const takedowns: ReviewTakedown[] = []
  for (const event of events) {
    if (event.type !== 'kill' || event.victimId === null) continue
    const kill = event.killerId === self.participantId
    if (!kill && !event.assistingParticipantIds.includes(self.participantId)) continue
    const victim = source(event.victimId)
    if (!victim) continue
    const raw = rawKills.get(`${event.timestamp}:${event.victimId}`)
    const credited = new Set(event.assistingParticipantIds)
    if (event.killerId !== null) credited.add(event.killerId)
    credited.delete(self.participantId)
    takedowns.push({
      timestamp: event.timestamp,
      point: event.position ? { x: event.position.x, y: event.position.y } : null,
      victim,
      kill,
      allies: credited.size,
      bounty: amount(raw?.bounty),
      shutdownBounty: event.shutdownBounty,
      firstBlood:
        firstBlood !== null &&
        firstBlood.timestamp === event.timestamp &&
        firstBlood.killerId === event.killerId,
      damage: readOwnDamage(
        widerList(raw?.victimTeamfightDamageReceived, raw?.victimDamageReceived),
        self.participantId
      )
    })
  }

  const deathDetails: ReviewDeathDetail[] = events
    .filter((event) => event.type === 'kill' && event.victimId === self.participantId)
    .map((event) => {
      const raw = rawKills.get(`${event.timestamp}:${event.victimId}`)
      const received = groupDamage(raw?.victimDamageReceived, participants)
      const dealt = groupDamage(raw?.victimDamageDealt, participants)
      const before = frames.filter((frame) => frame.timestamp <= event.timestamp).at(-1)
      // 分钟快照里的等级最多旧一分钟，所以以升级事件为准，快照只作兜底。和这次击杀同一毫秒的
      // 升级不算：实测 16.23 的 1738 次击杀里，击杀者有 286 次在同一毫秒升级（击杀给的经验），
      // 被击杀者一次也没有。
      const levelOf = (id: number | null) => {
        if (id === null) return null
        const snapshot = before?.participants.find((p) => p.participantId === id)?.level ?? null
        const recorded =
          levelUps
            .get(id)
            ?.filter((entry) => entry.timestamp < event.timestamp)
            .at(-1)?.level ?? null
        return recorded === null || snapshot === null
          ? (recorded ?? snapshot)
          : Math.max(recorded, snapshot)
      }
      return {
        timestamp: event.timestamp,
        sources: received ?? [],
        // 记录里没有任何伤害条目时是「未知」，不是 0。
        damageTaken: received?.length
          ? received.reduce((sum, entry) => sum + entry.total, 0)
          : null,
        damageDealt: dealt?.length ? dealt.reduce((sum, entry) => sum + entry.total, 0) : null,
        fightDamageTaken: totalDamage(raw?.victimTeamfightDamageReceived),
        fightDamageDealt: totalDamage(raw?.victimTeamfightDamageDealt),
        bounty: amount(raw?.bounty),
        level: levelOf(self.participantId),
        killerLevel: levelOf(event.killerId),
        fight: fightOfDeath.get(event.timestamp) ?? null,
        objectivesAfter: objectives
          .map((objective, index) => ({ objective, index }))
          .filter(
            ({ objective }) =>
              objective.own === false &&
              objective.timestamp > event.timestamp &&
              objective.timestamp <= event.timestamp + REVIEW_OBJECTIVE_AFTER_DEATH_MS
          )
          .map(({ index }) => index)
      }
    })

  const rawSelf = input.summary.json.participants.find(
    (p) => p.participantId === self.participantId
  )
  return {
    complete: input.eventsComplete,
    surrendered: flag(rawSelf?.gameEndedInSurrender),
    players: lines,
    teams: readTeams(input.summary, total, events, souls),
    build: readBuild(ordered, self.participantId, deaths, input.itemKind),
    opponentBuild:
      input.opponentId === null
        ? null
        : readBuild(
            ordered,
            input.opponentId,
            events.filter((event) => event.type === 'kill' && event.victimId === input.opponentId),
            input.itemKind
          ),
    assignment: rawSelf ? readAssignment(rawSelf, self.position) : null,
    riftElement,
    plates,
    bounties,
    killMarks,
    levels: readLevels(ordered, self.participantId, input.opponentId),
    checkpoints: readCheckpoints(
      frames,
      self.participantId,
      input.opponentId,
      durationMs,
      input.snapshotToleranceMs
    ),
    takedowns,
    deaths: deathDetails,
    objectives,
    fights,
    vision
  }
}
