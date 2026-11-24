import {
  type ReviewBaseline,
  type ReviewBaselineRow,
  type ReviewMetricUnit,
  compareToReviewBaseline
} from './baseline'
import type { ReviewCoachCatalogue } from './coach-catalogue'
import {
  POSITION,
  ROLE_TAG,
  type ReviewCoachNames,
  clock,
  decimal,
  percent,
  roleOrder,
  signed,
  whole
} from './coach-format'
import {
  buildLines,
  championKitLines,
  collectReviewItemIds,
  damageTypeLines,
  disambiguateItemNames,
  historyLines,
  itemTextLines,
  ownRuneLines,
  rosterLoadoutLines,
  runeCatalogueLines,
  spellLines,
  statSnapshotLines,
  statisticsLines
} from './coach-loadout'
import type { ReviewLoadoutHistory, ReviewLoadoutStatistics } from './coach-statistics'
import { classifyReviewDeathZone } from './death-map'
import type { ReviewDigestMetricKey } from './match-digest'
import {
  REVIEW_CHALLENGE_KEYS,
  REVIEW_EXTRA_CHALLENGE_KEYS,
  REVIEW_FIGHT_GAP_MS,
  REVIEW_FIGHT_MIN_CHAMPIONS,
  REVIEW_FIGHT_MIN_KILLS,
  REVIEW_OBJECTIVE_SNAPSHOT_MAX_OFFSET_MS,
  REVIEW_SHOP_AFTER_DEATH_MS
} from './match-report'
import { buildReviewLaneGoldDiffs, buildReviewMinuteRows } from './minute-table'
import type {
  ReviewDamageSlots,
  ReviewDamageSource,
  ReviewMatch,
  ReviewObjective,
  ReviewPlayerLine,
  ReviewPoint,
  ReviewPosition,
  ReviewReport,
  ReviewRoleAssignment
} from './types'

// [lolps] 教练资料包：把一局的完整事实、本人的平时水平和近期状态整理成一份文字资料。
// 这是 AI 教练能看到的全部内容，所以只写记录下来的事实，缺的就写「未知」，不补不猜。
// 资料里不出现任何玩家的名字或账号标识，只用英雄和位置指代。
// 资料固定用中文书写：它是给模型读的，不是界面文字；回答用什么语言由提示词决定。

export type { ReviewCoachNames } from './coach-format'

/** The player's rank and recent form, taken from the rank log. Every part is optional. */
export interface ReviewCoachForm {
  /** e.g. 「黄金 II · 40 胜点」; null when unknown. */
  rank: string | null
  /** Record of the most recent counted ranked games in this queue. */
  recent: { games: number; wins: number } | null
  streak: { win: boolean; length: number } | null
  /** LP change of the reviewed game; null when it was not recorded. */
  lpDelta: number | null
  /** 1-based place of the reviewed game in its back-to-back session. */
  sessionIndex: number | null
  /** Straight losses right before the reviewed game in the same session. */
  lossesBefore: number | null
}

export interface ReviewCoachContextInput {
  match: ReviewMatch
  /** Typical numbers of the same player; null when the archive has too few games. */
  baseline: ReviewBaseline | null
  form: ReviewCoachForm | null
  /** Matchup notes for this exact matchup, if the built-in notes have one. */
  tips: readonly string[]
  names: ReviewCoachNames
  /** The client's own texts for runes, items and summoner spells; null while they are not loaded. */
  catalogue?: ReviewCoachCatalogue | null
  /** What players of a comparable rank take on this champion; null when it could not be had. */
  statistics?: ReviewLoadoutStatistics | null
  /** How the same player set this champion up in other games kept on this device. */
  history?: ReviewLoadoutHistory | null
}

/** 逐项展开写的「最突出项目」最多这么多条，其余只列数值。 */
export const REVIEW_COACH_MAX_EXTREME_ROWS = 12

export interface ReviewCoachContext {
  text: string
  /** Section titles in order, for display and tests. */
  sections: string[]
}

const ZONE: Record<ReturnType<typeof classifyReviewDeathZone>, string> = {
  'mid-own': '中路己方半场',
  'mid-enemy': '中路敌方半场',
  'top-own': '上路己方半场',
  'top-enemy': '上路敌方半场',
  'bot-own': '下路己方半场',
  'bot-enemy': '下路敌方半场',
  'river-top': '上河道（男爵侧）',
  'river-bot': '下河道（小龙侧）',
  'jungle-own-top': '己方上半野区',
  'jungle-own-bot': '己方下半野区',
  'jungle-enemy-top': '敌方上半野区',
  'jungle-enemy-bot': '敌方下半野区',
  'own-base': '己方基地',
  'enemy-base': '敌方基地'
}

const OBJECTIVE_KIND: Record<ReviewObjective['kind'], string> = {
  dragon: '小龙',
  elder: '远古巨龙',
  herald: '峡谷先锋',
  grubs: '虚空巢虫',
  baron: '纳什男爵',
  atakhan: '厄塔汗',
  tower: '防御塔',
  inhibitor: '水晶',
  other: '其它目标'
}

const OBJECTIVE_DETAIL: Record<string, string> = {
  FIRE_DRAGON: '炼狱',
  WATER_DRAGON: '海洋',
  EARTH_DRAGON: '山脉',
  AIR_DRAGON: '云端',
  HEXTECH_DRAGON: '海克斯',
  CHEMTECH_DRAGON: '炼金',
  ELDER_DRAGON: '远古',
  OUTER_TURRET: '外塔',
  INNER_TURRET: '二塔',
  BASE_TURRET: '高地塔',
  NEXUS_TURRET: '门牙塔'
}

const LANE: Record<string, string> = { TOP_LANE: '上路', MID_LANE: '中路', BOT_LANE: '下路' }

/** Dragon soul names as the timeline writes them. An unknown name is passed through as it is. */
const SOUL: Record<string, string> = {
  Infernal: '炼狱',
  Ocean: '海洋',
  Mountain: '山脉',
  Cloud: '云端',
  Hextech: '海克斯',
  Chemtech: '炼金'
}

const WARD: Record<string, string> = {
  YELLOW_TRINKET: '饰品眼',
  SIGHT_WARD: '辅助眼',
  CONTROL_WARD: '控制守卫',
  BLUE_TRINKET: '远见改造'
}

const SOURCE_KIND: Record<ReviewDamageSource['kind'], string> = {
  champion: '英雄',
  turret: '防御塔',
  minion: '小兵',
  monster: '野怪',
  other: '其它'
}

const SKILL_SLOT = ['', 'Q', 'W', 'E', 'R']

const CHALLENGE: Record<(typeof REVIEW_CHALLENGE_KEYS)[number], string> = {
  soloKills: '单杀',
  quickSoloKills: '快速单杀',
  outnumberedKills: '以少打多击杀',
  killsNearEnemyTurret: '敌方塔下击杀',
  killsUnderOwnTurret: '己方塔下击杀',
  skillshotsHit: '非指向技能命中',
  skillshotsDodged: '躲开非指向技能',
  dodgeSkillShotsSmallWindow: '极限躲技能',
  landSkillShotsEarlyGame: '前期技能命中',
  enemyChampionImmobilizations: '控住敌方英雄',
  immobilizeAndKillWithAlly: '控制后协同击杀',
  pickKillWithAlly: '协同抓单击杀',
  saveAllyFromDeath: '救下队友',
  survivedSingleDigitHpCount: '个位数血量存活',
  tookLargeDamageSurvived: '承受大量伤害后存活',
  laneMinionsFirst10Minutes: '前 10 分钟兵线补刀',
  jungleCsBefore10Minutes: '前 10 分钟野怪',
  maxCsAdvantageOnLaneOpponent: '对位最大补刀领先',
  maxLevelLeadLaneOpponent: '对位最大等级领先',
  turretPlatesTaken: '参与拿下镀层（协助的也算）',
  bountyGold: '赏金金币',
  controlWardsPlaced: '放置控制守卫',
  stealthWardsPlaced: '放置隐形守卫',
  wardTakedowns: '排眼参与',
  wardTakedownsBefore20M: '20 分钟前排眼参与',
  visionScoreAdvantageLaneOpponent: '对位视野得分优势',
  enemyJungleMonsterKills: '敌方野区野怪',
  alliedJungleMonsterKills: '己方野区野怪',
  scuttleCrabKills: '河蟹',
  buffsStolen: '偷取增益野怪',
  epicMonsterSteals: '抢下史诗野怪',
  abilityUses: '技能施放总次数',
  unseenRecalls: '无视野回城'
}

const EXTRA_CHALLENGE: Record<(typeof REVIEW_EXTRA_CHALLENGE_KEYS)[number], string> = {
  killsOnOtherLanesEarlyJungleAsLaner: '前期到别的路或野区击杀',
  teleportTakedowns: '传送后参与击杀',
  multikillsAfterAggressiveFlash: '闪现进场后多杀',
  quickCleanse: '及时净化',
  controlWardTimeCoverageInRiverOrEnemyHalf: '控制守卫在河道或敌方半区的覆盖时间',
  wardsGuarded: '保护己方守卫',
  survivedThreeImmobilizesInFight: '一场交战中被控三次仍存活',
  knockEnemyIntoTeamAndKill: '把敌人推向队友后击杀',
  initialBuffCount: '开局拿到的增益野怪',
  initialCrabCount: '第一轮河蟹',
  killsOnLanersEarlyJungleAsJungler: '前期对线上英雄的击杀（打野）',
  junglerKillsEarlyJungle: '前期在野区的击杀（打野）',
  epicMonsterKillsWithin30SecondsOfSpawn: '史诗野怪刷新 30 秒内拿下',
  epicMonsterKillsNearEnemyJungler: '敌方打野在附近时拿下史诗野怪',
  completeSupportQuestInTime: '按时完成辅助装任务（1 为是）'
}

type ChallengeKey =
  (typeof REVIEW_CHALLENGE_KEYS)[number] | (typeof REVIEW_EXTRA_CHALLENGE_KEYS)[number]
/** 资料里写的官方计数：先是「完整数据」页也显示的那些，再是只给教练的几项。 */
const COACH_CHALLENGES: ReadonlyArray<readonly [ChallengeKey, string]> = [
  ...REVIEW_CHALLENGE_KEYS.map((key) => [key, CHALLENGE[key]] as const),
  ...REVIEW_EXTRA_CHALLENGE_KEYS.map((key) => [key, EXTRA_CHALLENGE[key]] as const)
]
/**
 * 资料里不写的几项。实测 16.23（280 个视角）：技能施放总次数恒等于 Q、W、E、R 四个次数之和，
 * 抢下史诗野怪恒等于战绩里的抢到地图资源，两项都在别处写过了；赏金金币的口径不明，
 * 和击杀记录里的终结赏金加不到一起；对位视野得分优势是一个比例（接近「（本人 − 对位）÷ 对位」），
 * 不是分差，而两人的视野得分本来就写了。这两项写出来只会被当成矛盾。
 */
const CHALLENGE_NOT_WRITTEN = new Set<ChallengeKey>([
  'abilityUses',
  'epicMonsterSteals',
  'bountyGold',
  'visionScoreAdvantageLaneOpponent'
])
/** 这一项是 0 到 1 的比例。 */
const CHALLENGE_SHARES = new Set<ChallengeKey>(['controlWardTimeCoverageInRiverOrEnemyHalf'])
/** 这些只在特定位置或打法下才有意义，是 0 就不写，免得每一局都占一行。 */
const CHALLENGE_SKIP_ZERO = new Set<ChallengeKey>([
  'multikillsAfterAggressiveFlash',
  'quickCleanse',
  'wardsGuarded',
  'survivedThreeImmobilizesInFight',
  'knockEnemyIntoTeamAndKill',
  'initialBuffCount',
  'initialCrabCount',
  'epicMonsterKillsWithin30SecondsOfSpawn',
  'epicMonsterKillsNearEnemyJungler',
  'completeSupportQuestInTime'
])

/** 名字和游戏里的信号对得上的几种；其余几种（英文名分不清是哪个信号）合在一起计数。 */
const PING: Record<string, string> = {
  enemyMissingPings: '敌人不见了',
  onMyWayPings: '正在路上',
  assistMePings: '请求协助',
  allInPings: '全力进攻',
  pushPings: '推进',
  enemyVisionPings: '敌方有视野',
  needVisionPings: '需要视野'
}

const CHECKPOINT_LABELS = Object.fromEntries(
  [5, 10, 15, 20].flatMap((minute) => [
    [`cs${minute}`, `${minute} 分钟补刀`],
    [`goldDiff${minute}`, `${minute} 分钟对位经济差`],
    [`csDiff${minute}`, `${minute} 分钟对位补刀差`],
    [`xpDiff${minute}`, `${minute} 分钟对位经验差`],
    [`levelDiff${minute}`, `${minute} 分钟对位等级差`]
  ])
)

/** Chinese names of the digest metrics, used wherever a metric is written out in words. */
export const REVIEW_DIGEST_METRIC_LABELS = {
  kills: '击杀',
  deaths: '死亡',
  assists: '助攻',
  level: '局末等级',
  cs: '补刀',
  csPerMinute: '每分钟补刀',
  gold: '经济',
  goldPerMinute: '每分钟经济',
  damage: '对英雄伤害',
  damagePerMinute: '每分钟对英雄伤害',
  damageTaken: '承受伤害',
  damageTakenPerMinute: '每分钟承受伤害',
  damageShare: '输出占本队比例',
  damageTakenShare: '承伤占本队比例',
  goldShare: '经济占本队比例',
  killParticipation: '参团率',
  visionScore: '视野得分',
  visionPerMinute: '每分钟视野得分',
  wardsPlaced: '放眼数',
  wardsKilled: '排眼数',
  controlWardsBought: '购买控制守卫',
  secondsDead: '阵亡时间合计',
  deadShare: '阵亡时间占全局比例',
  // 是「经济 − 已花金币」，不是局末身上的金币：卖装备退回的钱不在里面。
  unspentGold: '局末经济减去已花金币',
  summoner1Casts: '第一个召唤师技能施放次数',
  summoner2Casts: '第二个召唤师技能施放次数',
  ultimateCasts: '大招施放次数',
  csDiffEnd: '局末对位补刀差',
  goldDiffEnd: '局末对位经济差',
  damageDiffEnd: '局末对位输出差',
  visionDiffEnd: '局末对位视野得分差',
  levelDiffEnd: '局末对位等级差',
  level2Lead: '到 2 级相对对位的先后',
  level6At: '到 6 级的时间',
  level6Lead: '到 6 级相对对位的先后',
  level11At: '到 11 级的时间',
  level16At: '到 16 级的时间',
  firstCoreAt: '第一件成装时间',
  secondCoreAt: '第二件成装时间',
  thirdCoreAt: '第三件成装时间',
  bootsAt: '升级鞋时间',
  // 这两项只算自己回城的购物：紧接在阵亡之后的那次不算。
  firstRecallAt: '第一次主动回城补给的时间（阵亡后的购物不算）',
  recalls: '主动回城补给次数（阵亡后的购物不算）',
  takedowns: '击杀加助攻次数',
  soloKills: '单杀',
  soloDeaths: '被单杀',
  executions: '被防御塔或野怪处决',
  firstBloodTakedown: '参与一血',
  fights: '全场交战数',
  fightsJoined: '参与的交战数',
  fightsWon: '参与且打赢的交战数',
  fightsLost: '参与且打输的交战数',
  fightsDiedFirst: '在己方第一个阵亡的交战数',
  deathsInFights: '交战中的阵亡',
  deathsOutsideFights: '交战外的阵亡',
  epicOwn: '己方拿下的史诗野怪',
  epicEnemy: '敌方拿下的史诗野怪',
  epicCredited: '本人参与拿下的史诗野怪',
  towersOwn: '己方推掉的防御塔',
  towersEnemy: '敌方推掉的防御塔',
  towersCredited: '本人参与推掉的防御塔',
  enemyObjectivesAfterDeath: '本人阵亡后 90 秒内敌方拿下的资源',
  wardEvents: '时间线记录的放眼次数',
  controlWardsPlaced: '放置控制守卫',
  wardsCleared: '时间线记录的排眼次数',
  ...CHECKPOINT_LABELS
} as Record<ReviewDigestMetricKey, string>

/** A metric value written the way a person would say it. */
export function formatReviewMetric(value: number, unit: ReviewMetricUnit) {
  switch (unit) {
    case 'time':
      return clock(value)
    case 'seconds':
      return `${Math.round(value)} 秒`
    case 'share':
      return `${Math.round(value * 100)}%`
    case 'rate':
      return decimal(value)
    case 'diff':
      return unitDiff(value)
    default:
      return decimal(value)
  }
}
function unitDiff(value: number) {
  const rounded = Number(value.toFixed(1))
  return `${rounded > 0 ? '+' : ''}${rounded}`
}

/**
 * Level leads are stored in milliseconds; everything else in a diff unit is a plain amount.
 * `typical` marks a value taken from other games: a time among them is not a moment of the
 * reviewed game, so it is written in words (「3 分 54 秒」) and never as a clock the reader
 * could click.
 */
function formatBaselineValue(
  row: Pick<ReviewBaselineRow, 'key' | 'unit'>,
  value: number,
  typical = false
) {
  if (row.key === 'level2Lead' || row.key === 'level6Lead') {
    const seconds = Math.round(value / 1000)
    return seconds === 0 ? '同时' : `${seconds > 0 ? '早' : '晚'} ${Math.abs(seconds)} 秒`
  }
  if (typical && row.unit === 'time') {
    const seconds = Math.max(0, Math.round(value / 1000))
    return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  }
  return formatReviewMetric(value, row.unit)
}

const SLOT_LABELS: ReadonlyArray<readonly [string, keyof ReviewDamageSlots]> = [
  ['普攻', 'basic'],
  ['被动', 'passive'],
  ['Q', 'q'],
  ['W', 'w'],
  ['E', 'e'],
  ['R', 'r'],
  ['召唤师技能', 'summoner'],
  ['其它', 'other']
]
const slotBreakdown = (slots: ReviewDamageSlots) =>
  SLOT_LABELS.filter(([, key]) => slots[key] > 0)
    .map(([label, key]) => `${label} ${Math.round(slots[key])}`)
    .join('、')

const preference = (entry: ReviewRoleAssignment['preferences'][number]) =>
  entry === 'FILL' ? '补位' : POSITION[entry]

function assignmentText(assignment: ReviewRoleAssignment, played: ReviewPosition) {
  const [first, second] = assignment.preferences
  const chosen = [first && `首选 ${preference(first)}`, second && `次选 ${preference(second)}`]
    .filter(Boolean)
    .join('、')
  const how = {
    primary: '这局打的是本人排队时的首选位置',
    secondary: '这局打的是本人排队时的次选位置',
    autofill: '这局是被补位的，打的不是本人排队时选的位置',
    fill: '本人排队时首选的就是补位'
  }[assignment.choice]
  return `位置分配：${how}${chosen ? `（${chosen}）` : ''}。${
    assignment.assigned
      ? `匹配分到的是${POSITION[assignment.assigned]}，实际打的是${POSITION[played]}。`
      : ''
  }`
}

export function buildReviewCoachContext(input: ReviewCoachContextInput): ReviewCoachContext {
  const { match } = input
  const { meta, quality } = match
  const report = match.report ?? null
  const catalogue = input.catalogue ?? null
  // 同一份资料里有两件装备重名时，名字后面带上总价把它们分开。
  const names = report
    ? disambiguateItemNames(
        input.names,
        collectReviewItemIds(report, input.statistics ?? null),
        catalogue
      )
    : input.names
  const sections: Array<{ title: string; lines: string[] }> = []
  /** `empty` is written when nothing is listed, so "none happened" is never mistaken for "not told". */
  const add = (title: string, lines: Array<string | null | false | undefined>, empty?: string) => {
    const kept = lines.filter((line): line is string => !!line)
    if (kept.length) sections.push({ title, lines: kept })
    else if (empty) sections.push({ title, lines: [empty] })
  }

  const lineOf = (participantId: number | null) =>
    participantId === null
      ? null
      : (report?.players.find((player) => player.participantId === participantId) ?? null)
  const own = lineOf(meta.participantId)
  const opponent = lineOf(meta.opponentId)
  const side = (teamId: 100 | 200) => (teamId === meta.teamId ? '我方' : '敌方')
  const color = (teamId: 100 | 200) => (teamId === 100 ? '蓝色方' : '红色方')
  const who = (championId: number | null, role: ReviewPosition | null) =>
    championId === null
      ? '未知'
      : `${names.champion(championId)}${role && role !== 'UNKNOWN' ? `（${POSITION[role]}）` : ''}`
  const zone = (point: ReviewPoint | null) =>
    point ? ZONE[classifyReviewDeathZone(point, meta.teamId)] : '位置未知'

  // ── 对局概况 ───────────────────────────────────────────────────────────
  const roster = (teamId: 100 | 200) =>
    match.participants
      .filter((participant) => participant.teamId === teamId)
      .sort((a, b) => roleOrder(a.position) - roleOrder(b.position))
      .map(
        (participant) =>
          `${POSITION[participant.position]} ${names.champion(participant.championId)}${
            participant.participantId === meta.participantId ? '（本人）' : ''
          }`
      )
      .join('、')
  const away = (report?.players ?? []).filter((player) => player.afk)
  add('对局概况', [
    `版本 ${meta.patch || '未知'}；${names.queue(meta.queueId)}；时长 ${clock(meta.gameDuration * 1000)}；本人${
      meta.win ? '获胜' : '失败'
    }${
      report?.surrendered == null ? '' : report.surrendered ? '（以投降结束）' : '（不是投降结束）'
    }。`,
    `本人：${names.champion(meta.championId)}，${POSITION[meta.position]}，${color(meta.teamId)}。对位：${
      meta.opponentChampionId === null
        ? '未能唯一确认同位置对手，下面所有「对位」数据都缺失'
        : names.champion(meta.opponentChampionId)
    }。`,
    report?.assignment ? assignmentText(report.assignment, meta.position) : null,
    match.participants.length ? `${color(100)}（${side(100)}）：${roster(100)}。` : null,
    match.participants.length ? `${color(200)}（${side(200)}）：${roster(200)}。` : null,
    away.length
      ? `官方标记的挂机玩家：${away
          .map(
            (player) =>
              `${side(player.teamId)} ${POSITION[player.position]} ${names.champion(player.championId)}`
          )
          .join('、')}。`
      : null,
    `数据质量：时间线${
      quality.missingFrames ? `缺 ${quality.missingFrames} 个分钟快照` : '分钟快照齐全'
    }；事件记录${
      report
        ? report.complete
          ? '与战绩核对一致'
          : '与战绩核对不上，下面按事件列出的条目可能不全，次数只是下限'
        : '不可用'
    }。`
  ])

  if (!report || !own) {
    add('资料缺失', [
      '这一局没有完整的单局报告（多半是历史存档），无法提供逐项事实；请先重新读取这一局。'
    ])
    return finish(sections)
  }
  const loadout = { match, report, names, catalogue }

  // ── 最终数据 ───────────────────────────────────────────────────────────
  const statLine = (player: ReviewPlayerLine) =>
    [
      `${side(player.teamId)} ${POSITION[player.position]} ${names.champion(player.championId)}${
        player.participantId === meta.participantId ? '（本人）' : ''
      }`,
      `KDA ${whole(player.kills)}/${whole(player.deaths)}/${whole(player.assists)}`,
      `等级 ${whole(player.level)}`,
      `补刀 ${whole(player.cs)}`,
      `经济 ${whole(player.gold)}`,
      `对英雄伤害 ${whole(player.damage)}`,
      `承伤 ${whole(player.damageTaken)}`,
      `视野得分 ${whole(player.visionScore)}`,
      `参团率 ${percent(player.killParticipation)}`,
      `输出占比 ${percent(player.damageShare)}`
    ].join('｜')
  add(
    '最终数据（十人，占比的分母是各自队伍五人之和）',
    [...report.players]
      .sort(
        (a, b) =>
          Number(b.teamId === meta.teamId) - Number(a.teamId === meta.teamId) ||
          roleOrder(a.position) - roleOrder(b.position) ||
          a.participantId - b.participantId
      )
      .map(statLine)
  )

  const pings = own.pings
  const namedPings = pings
    ? Object.entries(PING)
        .filter(([key]) => (pings[key] ?? 0) > 0)
        .map(([key, label]) => `${label} ${pings[key]}`)
    : []
  // 英文名对不上具体信号的几种不猜是哪个，原名照写，免得「其它」两个字把撤退之类的信号盖住。
  const otherPings = pings
    ? Object.entries(pings)
        .filter(([key, value]) => !(key in PING) && value > 0)
        .map(([key, value]) => `${key} ${value}`)
    : []
  add('本人的补充数据', [
    // 实测 16.23（280 个视角）：官方的「对地图目标」就是对防御塔加对史诗野怪（差不超过 1），
    // 所以写这两项，不写合计：只推了塔的时候合计和对防御塔一样，会被看成抄错了。
    `伤害构成：物理 ${whole(own.physicalDamage)}、魔法 ${whole(own.magicDamage)}、真实 ${whole(own.trueDamage)}；对防御塔 ${whole(own.turretDamage)}、对史诗野怪 ${whole(own.epicMonsterDamage)}。`,
    `承伤 ${whole(own.damageTaken)}，另外减免 ${whole(own.damageMitigated)}；治疗 ${whole(own.healing)}${
      own.allyHealing || own.allyShielding
        ? `（给队友的治疗 ${whole(own.allyHealing)}、护盾 ${whole(own.allyShielding)}）`
        : ''
    }；控制敌方 ${whole(own.ccSeconds)} 秒。`,
    // 整局没有阵亡时，官方的「最长存活」记的是 0，不是整局的时长。
    `野怪补刀 ${whole(own.jungleCs)}；已花金币 ${whole(own.goldSpent)}；阵亡时间合计 ${whole(own.secondsDead)} 秒，${
      own.deaths === 0 && !own.longestLife
        ? '整局没有阵亡'
        : `最长存活 ${whole(own.longestLife)} 秒`
    }；最大连杀 ${whole(own.largestKillingSpree)}，最大多杀 ${whole(own.largestMultiKill)}。`,
    `放眼 ${whole(own.wardsPlaced)}、排眼 ${whole(own.wardsKilled)}、购买控制守卫 ${whole(own.controlWardsBought)}。`,
    `技能施放次数：Q ${whole(own.casts.q)}、W ${whole(own.casts.w)}、E ${whole(own.casts.e)}、R ${whole(own.casts.r)}；召唤师技能 ${own.summonerSpells
      .map(
        (id, index) =>
          `${names.spell(id)} ${whole(index === 0 ? own.casts.summoner1 : own.casts.summoner2)} 次`
      )
      .join('、')}。`,
    `参与推掉防御塔 ${whole(own.turretTakedowns)}、水晶 ${whole(own.inhibitorTakedowns)}；亲手打死小龙 ${whole(own.dragonKills)}、男爵 ${whole(own.baronKills)}；抢到地图资源 ${whole(own.objectivesStolen)}。`,
    namedPings.length || otherPings.length
      ? `发出的信号：${[
          namedPings.join('、'),
          otherPings.length
            ? `官方只给了英文名、对不上游戏里具体哪种信号的：${otherPings.join('、')}`
            : ''
        ]
          .filter(Boolean)
          .join('；')}。`
      : pings
        ? '发出的信号：整局没有发过。'
        : null
  ])

  // ── 队伍资源 ───────────────────────────────────────────────────────────
  const plateLanes = ['TOP_LANE', 'MID_LANE', 'BOT_LANE'].flatMap((lane) => {
    const inLane = report.plates.filter((plate) => plate.lane === lane && plate.own !== null)
    return inLane.length
      ? [
          `${LANE[lane]} 我方打掉 ${inLane.filter((plate) => plate.own).length} 层、敌方打掉 ${
            inLane.filter((plate) => !plate.own).length
          } 层`
        ]
      : []
  })
  const ownPlates = report.plates.filter((plate) => plate.byPlayer)
  add('队伍资源', [
    ...report.teams.map(
      (team) =>
        // 官方的小龙数把远古巨龙也算在内。
        `${side(team.teamId)}：防御塔 ${whole(team.towers)}、水晶 ${whole(team.inhibitors)}、${
          team.dragonTypes.includes('ELDER_DRAGON') ? '小龙与远古巨龙共' : '小龙'
        } ${whole(team.dragons)}${
          team.dragonTypes.length
            ? `（${team.dragonTypes.map((type) => OBJECTIVE_DETAIL[type] ?? type).join('、')}）`
            : ''
        }${team.soul ? `、龙魂 ${SOUL[team.soul] ?? OBJECTIVE_DETAIL[team.soul] ?? team.soul}` : ''}、先锋 ${whole(team.heralds)}、巢虫 ${whole(team.grubs)}、男爵 ${whole(team.barons)}${
          // 实测 16.23：战绩里大多没有厄塔汗这一项，时间线里也没有它的事件；没有就不写，不写「未知」。
          team.atakhans === null ? '' : `、厄塔汗 ${whole(team.atakhans)}`
        }；一血 ${
          team.firstBlood == null ? '未知' : team.firstBlood ? '是' : '否'
        }、一塔 ${team.firstTower == null ? '未知' : team.firstTower ? '是' : '否'}；禁用 ${
          team.bans.length ? team.bans.map((id) => names.champion(id)).join('、') : '无记录'
        }。`
    ),
    report.riftElement
      ? `峡谷元素：${SOUL[report.riftElement.name] ?? report.riftElement.name}，${clock(report.riftElement.timestamp)} 定下（之后的小龙和龙魂都是这个元素）。`
      : null,
    plateLanes.length
      ? `防御塔镀层：${plateLanes.join('；')}。${
          ownPlates.length
            ? `记录的击破者是本人的有 ${ownPlates.length} 层：${ownPlates
                .map((plate) =>
                  `${clock(plate.timestamp)} ${plate.lane ? (LANE[plate.lane] ?? plate.lane) : ''}`.trim()
                )
                .join('、')}。`
            : '没有哪一层的击破者记的是本人。'
        }「官方挑战统计」里的「参与拿下镀层」把协助的也算上，所以不会比这个数小。`
      : null,
    report.bounties.length
      ? `目标赏金（落后的一方拿下地图资源有额外金币的时段）：${report.bounties
          .map(
            (bounty) =>
              `${clock(bounty.start)}–${bounty.end === null ? '对局结束' : clock(bounty.end)} ${
                bounty.own === null ? '归属未知' : bounty.own ? '我方可以领' : '敌方可以领'
              }`
          )
          .join('；')}。`
      : null
  ])

  // ── 带了什么 ───────────────────────────────────────────────────────────
  add('十人的符文、召唤师技能与局末装备', rosterLoadoutLines(loadout))
  add(
    '本人的符文（说明取自现在的客户端；「本局记录」是战绩给这颗符文记的结算数字，时间为 0:00 表示没有达成或没有触发）',
    ownRuneLines(loadout, input.history ?? null),
    '战绩里没有本人的符文记录。'
  )
  add('召唤师技能', spellLines(loadout))
  add('伤害类型（看防御该针对什么、对面怕什么）', damageTypeLines(loadout))
  add(
    '英雄技能（本人和敌方五人；文字取自现在的客户端，是概括性的说明，多半没有伤害数值；对面有没有治疗、护盾、控制、位移，从这里看，不要凭记忆）',
    championKitLines(loadout),
    catalogue ? '这一次没有取到客户端里的英雄技能说明；对面英雄的技能不要凭记忆下结论。' : undefined
  )

  // ── 对线与节奏 ─────────────────────────────────────────────────────────
  const laneDiffs = buildReviewLaneGoldDiffs(match)
  add(
    '对线与节奏（每 5 分钟一个检查点，行首是那张分钟快照的时刻；差值 = 本人 − 对位，没有对应快照就是未知）',
    [
      ...report.checkpoints
        .filter((checkpoint) => checkpoint.timestamp !== null)
        .map(
          (checkpoint) =>
            `${clock(checkpoint.timestamp!)}：本人 经济 ${whole(checkpoint.own?.gold)}、补刀 ${whole(checkpoint.own?.cs)}、等级 ${whole(checkpoint.own?.level)}、累计对英雄伤害 ${whole(checkpoint.own?.damage)}；对位经济差 ${signed(checkpoint.goldDiff)}、补刀差 ${signed(checkpoint.csDiff)}、经验差 ${signed(checkpoint.xpDiff)}、等级差 ${signed(checkpoint.levelDiff)}；团队经济差 ${signed(checkpoint.teamGoldDiff)}。`
        ),
      report.levels.length
        ? `升级时间（${
            meta.opponentId === null ? '本人' : '本人 / 对位'
          }；「未到」是整局没有升到这一级）：${report.levels
            .filter((timing) => [2, 3, 6, 9, 11, 13, 16, 18].includes(timing.level))
            .map(
              (timing) =>
                `${timing.level} 级 ${timing.own === null ? '未到' : clock(timing.own)}${
                  meta.opponentId === null
                    ? ''
                    : ` / ${timing.opponent === null ? '未到' : clock(timing.opponent)}`
                }`
            )
            .join('；')}。`
        : null,
      // 其它几路当时的局面：我方同位置的人比敌方多多少经济。
      laneDiffs.length
        ? `各路经济差（我方减敌方同位置的人）：${laneDiffs
            .map(
              (entry) =>
                `${entry.minute} 分钟 ${entry.roles
                  .map(({ role, diff }) => `${POSITION[role]} ${signed(diff)}`)
                  .join('、')}`
            )
            .join('；')}。`
        : null
    ]
  )
  add(
    // 实测 16.23：同一个人的护甲和魔抗在相邻两行之间一起掉了 30，中间没有卖过装备：
    // 快照把技能给的临时加成也算进去了。不写明的话，这种起落会被读成装备的变化。
    '属性快照（分钟快照那一刻的面板数值，当时身上有技能、增益给的临时加成时也算在里面，所以同一个人的数会在相邻两行之间忽高忽低，这种起落不是装备的变化，装备的变化看「出装与回城」；用来看谁在堆攻击、谁在堆防御）',
    statSnapshotLines(loadout)
  )

  // ── 出装与技能 ─────────────────────────────────────────────────────────
  // 实测 16.23（28 局）：每局开局都有两笔辅助装的购买记录，时间线没有写是谁买的，
  // 所以两个辅助的购买记录里都没有它，看上去像是出门什么都没买。
  const supportStartNote = (player: ReviewPlayerLine) =>
    player.position === 'UTILITY'
      ? '辅助开局的那件辅助装是系统自动给的，时间线没有把这笔购买记在任何人名下，所以上面的购买记录里没有它；出门时已经花掉的金币里有它的一份。'
      : null
  add(
    '出装与回城（按一次停留分组，时间是这次停留里第一笔买卖的时刻，所以同一次停留里后买的东西会比它晚几秒；「开局购买」是出门装，「阵亡后」表示这次购物紧接在本人阵亡之后；阵亡后没有买东西的那几次不会出现在这里，见「阵亡」）',
    [...buildLines(report.build, names, own.items, catalogue), supportStartNote(own)]
  )
  if (report.opponentBuild && opponent)
    add(
      `对位的出装与回城（对位是敌方 ${POSITION[opponent.position]} ${names.champion(opponent.championId)}；写法同上，「阵亡后」指紧接在他自己阵亡之后）`,
      [
        ...buildLines(report.opponentBuild, names, opponent.items, catalogue),
        supportStartNote(opponent)
      ]
    )
  add(
    '装备说明（双方对线的两个人买过的出门装、鞋和成装，加上统计里这个英雄常出的；随等级或属性变化的数客户端不给，写作「若干」）',
    itemTextLines(loadout, input.statistics ?? null)
  )
  const skillOrder = (skills: ReviewReport['build']['skills']) =>
    skills.map((skill) => SKILL_SLOT[skill.slot]).join(' ')
  add(
    '技能加点（照技能升级的记录原样列出；长度不一定等于等级：额外得到的技能点会让它多出一个，没有记录的那一点会让它少一个）',
    [
      report.build.skills.length
        ? `加点顺序：${skillOrder(report.build.skills)}。`
        : '加点顺序：时间线没有记录。',
      report.build.skillPriority
        ? `能确定的主加顺序：${report.build.skillPriority.map((slot) => SKILL_SLOT[slot]).join(' > ')}。`
        : null,
      report.opponentBuild?.skills.length
        ? `对位的加点顺序：${skillOrder(report.opponentBuild.skills)}。`
        : null
    ]
  )

  // ── 击杀与助攻 ─────────────────────────────────────────────────────────
  add(
    `击杀与助攻（共 ${report.takedowns.length} 次；「本人对其造成」取自这次击杀记录里口径较宽的那份伤害清单，也就是官方的「团战」清单，往前算得比一次交手更久，所以会比同一时刻本人阵亡记录里的「阵亡前打出伤害」大；占比的分母是这份清单里他受到的全部伤害，小兵、防御塔和没被记上助攻的人打的都在内。「单杀」只表示没有队友被记上助攻）`,
    report.takedowns.map((takedown) => {
      const damage = takedown.damage
      const breakdown = damage ? slotBreakdown(damage.slots) : ''
      return `${clock(takedown.timestamp)} ${zone(takedown.point)}：${takedown.kill ? '击杀' : '助攻'} ${who(
        takedown.victim.championId,
        takedown.victim.role
      )}，${takedown.allies ? `另有 ${takedown.allies} 名队友参与` : '没有队友参与（单杀）'}${
        takedown.kill && takedown.bounty !== null
          ? `，击杀金币 ${takedown.bounty}${
              takedown.shutdownBounty ? `，终结赏金 ${takedown.shutdownBounty}` : ''
            }`
          : ''
      }${takedown.firstBlood ? '，一血' : ''}。${
        damage
          ? `本人对其造成 ${Math.round(damage.total)}${
              breakdown
                ? `〔${breakdown}${
                    damage.ignite > 0 ? `，其中点燃 ${Math.round(damage.ignite)}` : ''
                  }〕`
                : ''
            }，占记录里其所受伤害 ${Math.round(damage.victimTotal)} 的 ${percent(
              damage.total / damage.victimTotal
            )}。`
          : '伤害清单里没有本人对其造成的伤害。'
      }`
    }),
    '这一局本人没有击杀也没有助攻。'
  )

  // ── 阵亡 ──────────────────────────────────────────────────────────────
  const objectiveName = (objective: ReviewObjective) => {
    const lane = objective.lane ? (LANE[objective.lane] ?? objective.lane) : ''
    const detail = objective.detail ? (OBJECTIVE_DETAIL[objective.detail] ?? objective.detail) : ''
    if (objective.kind === 'dragon') return `${detail}小龙`
    if (objective.kind === 'tower') return `${lane}${detail || '防御塔'}`
    if (objective.kind === 'inhibitor') return `${lane}水晶`
    if (objective.kind === 'other') return `其它目标${detail ? `（${detail}）` : ''}`
    return OBJECTIVE_KIND[objective.kind]
  }
  const sourceText = (source: ReviewDamageSource) => {
    const breakdown = slotBreakdown(source.slots)
    const name =
      source.kind === 'champion' ? who(source.championId, source.role) : SOURCE_KIND[source.kind]
    return `${name} ${Math.round(source.total)}${
      source.kind === 'champion' && breakdown ? `〔${breakdown}〕` : ''
    }`
  }
  const deaths = match.deaths ?? []
  // 紧接在这次阵亡之后的那次购物；没有的话，人是带着身上的钱直接出门的。
  const shopAfter = (timestamp: number) =>
    report.build.visits.some(
      (visit) =>
        visit.afterDeath &&
        visit.timestamp > timestamp &&
        visit.timestamp - timestamp <= REVIEW_SHOP_AFTER_DEATH_MS &&
        visit.itemIds.length > 0
    )
  add(
    `阵亡（共 ${report.deaths.length} 次；伤害来源是这次击杀记录自带的清单，只覆盖阵亡前的一小段，不等于整场交战的全部伤害。同一条记录里还有一份官方叫「团战」的清单，往前算得更久，具体算多久官方没有说明，两份差得多时一并给出。「当时等级」按升级记录算，是阵亡前一刻的）`,
    report.deaths.map((detail, index) => {
      const death = deaths[index]
      const killers = death
        ? death.killer
          ? `${who(death.killer.championId, death.killer.role)}击杀${
              death.assists.length
                ? `，${death.assists.map((assist) => who(assist.championId, assist.role)).join('、')}助攻`
                : '，无人助攻（被单杀）'
            }`
          : '被防御塔、小兵或野怪处决'
        : '击杀者未知'
      const after = detail.objectivesAfter
        .map((objectiveIndex) => report.objectives[objectiveIndex])
        .filter(Boolean)
        .map(objectiveName)
      const byType = detail.sources.reduce(
        (sum, source) => ({
          physical: sum.physical + source.physical,
          magic: sum.magic + source.magic,
          trueDamage: sum.trueDamage + source.trueDamage
        }),
        { physical: 0, magic: 0, trueDamage: 0 }
      )
      const wider =
        (detail.fightDamageTaken ?? 0) > (detail.damageTaken ?? 0) ||
        (detail.fightDamageDealt ?? 0) > (detail.damageDealt ?? 0)
      return [
        `${clock(detail.timestamp)} ${zone(death?.point ?? null)}：${killers}。`,
        detail.sources.length
          ? `承受伤害 ${whole(detail.damageTaken)}，来源：${detail.sources.map(sourceText).join('；')}。按类型：物理 ${Math.round(byType.physical)}、魔法 ${Math.round(byType.magic)}、真实 ${Math.round(byType.trueDamage)}。`
          : '这次阵亡没有伤害来源记录。',
        detail.damageDealt === null
          ? detail.sources.length
            ? '击杀记录里没有本人阵亡前打出的伤害（可能没有打出，也可能没有记录）。'
            : ''
          : `阵亡前打出伤害 ${Math.round(detail.damageDealt)}。`,
        // 同一条记录里还有一份口径更宽的清单，数字更大时才值得一提。
        wider
          ? `按「团战」清单：承受 ${whole(detail.fightDamageTaken)}、打出 ${whole(detail.fightDamageDealt)}。`
          : '',
        detail.level !== null || detail.killerLevel !== null
          ? `当时等级：本人 ${whole(detail.level)}${
              death?.killer ? `、击杀者 ${whole(detail.killerLevel)}` : ''
            }。`
          : '',
        detail.fight === null ? '不在任何一场交战里。' : `属于第 ${detail.fight + 1} 场交战。`,
        // 被处决时记录里也有一个金额，但没有人拿到它。
        death?.killer && detail.bounty
          ? `送出击杀金币 ${detail.bounty}${
              death.shutdownBounty ? `，另有终结赏金 ${death.shutdownBounty}` : ''
            }。`
          : '',
        shopAfter(detail.timestamp) ||
        detail.timestamp + REVIEW_SHOP_AFTER_DEATH_MS > meta.gameDuration * 1000
          ? ''
          : '这次阵亡之后没有紧接着买下东西的记录（当时身上有多少钱，见「逐分钟数据」）。',
        after.length ? `此后 90 秒内敌方拿下：${after.join('、')}。` : ''
      ]
        .filter(Boolean)
        .join('')
    }),
    '这一局本人没有阵亡。'
  )

  // ── 全场击杀 ───────────────────────────────────────────────────────────
  const participantOf = new Map(match.participants.map((entry) => [entry.participantId, entry]))
  const fighter = (participantId: number) => {
    const participant = participantOf.get(participantId)
    return participant
      ? `${side(participant.teamId)} ${names.champion(participant.championId)}${
          participantId === meta.participantId ? '（本人）' : ''
        }`
      : '未知'
  }
  const kills = match.events.filter((event) => event.type === 'kill' && event.victimId !== null)
  const MULTI_KILL = ['', '', '双杀', '三杀', '四杀', '五杀']
  // 同一时刻同一个人连杀两人时标记只有一个，写在后一条上。
  const markOf = (event: (typeof kills)[number], index: number) => {
    if (event.killerId === null) return ''
    const next = kills[index + 1]
    if (next && next.timestamp === event.timestamp && next.killerId === event.killerId) return ''
    const mark = report.killMarks.find(
      (entry) => entry.timestamp === event.timestamp && entry.killerId === event.killerId
    )
    return mark
      ? [
          mark.multiKill ? (MULTI_KILL[mark.multiKill] ?? `${mark.multiKill} 连杀`) : '',
          mark.ace ? '团灭对方' : ''
        ]
          .filter(Boolean)
          .map((text) => `，${text}`)
          .join('')
      : ''
  }
  add(
    `全场击杀（共 ${kills.length} 次，十个人的都在；位置见「对局概况」的阵容。「被处决」是被防御塔、小兵或野怪打死，不算任何一方的人头；「双杀」「团灭对方」是时间线自己的标记）`,
    kills.map(
      (event, index) =>
        `${clock(event.timestamp)} ${zone(event.position)}：${
          event.killerId === null
            ? `${fighter(event.victimId!)} 被处决`
            : `${fighter(event.killerId)} 杀 ${fighter(event.victimId!)}`
        }${
          event.assistingParticipantIds.length
            ? `（助攻 ${event.assistingParticipantIds
                .map(
                  (id) =>
                    `${names.champion(participantOf.get(id)?.championId ?? 0)}${
                      id === meta.participantId ? '（本人）' : ''
                    }`
                )
                .join('、')}）`
            : ''
        }${event.shutdownBounty ? `，终结赏金 ${event.shutdownBounty}` : ''}${markOf(event, index)}`
    ),
    '时间线里没有英雄被击杀的记录。'
  )

  // ── 地图资源 ───────────────────────────────────────────────────────────
  // 远近只是某一张分钟快照里的距离，所以把是哪一张、离事件多久一起写出来。
  const proximity = (objective: ReviewObjective) => {
    if (objective.distance === null || objective.snapshotOffset === null) return ''
    // 相差几秒按两个钟点算（都只舍不入），这样和同一行里写出来的两个时间对得上。
    const snapshotAt = objective.timestamp + objective.snapshotOffset
    const offset = Math.floor(snapshotAt / 1000) - Math.floor(objective.timestamp / 1000)
    const when =
      offset === 0
        ? '按同一时刻的快照'
        : `按 ${clock(snapshotAt)} 的快照，比事件${offset < 0 ? '早' : '晚'} ${Math.abs(offset)} 秒`
    return `，本人${
      objective.distance <= 3000 ? '在附近' : objective.distance >= 7000 ? '离得很远' : '不在附近'
    }（${when}）`
  }
  add(
    `地图资源时间线（「在附近 / 不在附近 / 离得很远」是事件地点和最近一张分钟快照里本人位置的距离，快照最多相差 ${
      REVIEW_OBJECTIVE_SNAPSHOT_MAX_OFFSET_MS / 1000
    } 秒，只能说明那一刻的远近：十几秒足够走出很远。快照里本人是阵亡状态的不写远近）`,
    report.objectives.map((objective) => {
      const name = `${clock(objective.timestamp)} ${objectiveName(objective)}：`
      // 记录的击杀方是中立队伍：没有人拿下它（峡谷先锋到时间会自己离场）。
      if (objective.unclaimed)
        return `${name}没有哪一方拿下${objective.kind === 'herald' ? '，是它到时间自己离场了' : ''}（记录里的击杀方是中立）。`
      return `${name}${
        objective.own === null ? '归属未知' : objective.own ? '我方拿下' : '敌方拿下'
      }${
        objective.credited
          ? '，本人有参与'
          : objective.contested
            ? '，记录的参与者里也有本人（打到过它，但被敌方拿走）'
            : ''
      }${
        objective.sinceDeath === null
          ? ''
          : `，本人 ${Math.round(objective.sinceDeath / 1000)} 秒前刚阵亡`
      }${proximity(objective)}。`
    }),
    '时间线里没有防御塔、水晶或史诗野怪被拿下的记录。'
  )

  // ── 交战 ──────────────────────────────────────────────────────────────
  add(
    `交战（共 ${report.fights.length} 场；${REVIEW_FIGHT_GAP_MS / 1000} 秒内、相距不远的击杀归为同一场，至少 ${REVIEW_FIGHT_MIN_KILLS} 次击杀、或者一次击杀但卷入至少 ${REVIEW_FIGHT_MIN_CHAMPIONS} 人才算一场，所以单独的一次击杀通常不在这里。这是整理规则，不代表游戏里真有一场团战。「卷入」只数被记上击杀、助攻或被击杀的人，在场却没被记上的人不在内，所以「我方 1 名」不等于当时只有一个人在场）`,
    report.fights.map((fight, index) => {
      const after = fight.objectivesAfter
        .map((objectiveIndex) => report.objectives[objectiveIndex])
        .filter((objective) => objective && !objective.unclaimed)
        .map(
          (objective) =>
            `${objective.own === null ? '' : objective.own ? '我方' : '敌方'}${objectiveName(objective)}`
        )
      const ownPart =
        fight.ownKills + fight.ownAssists > 0 || fight.ownDeathOrder !== null
          ? `本人 ${fight.ownKills} 杀 ${fight.ownAssists} 助，${
              fight.ownDeathOrder === null ? '存活' : `在己方第 ${fight.ownDeathOrder} 个阵亡`
            }`
          : '本人没有参与记录'
      // 地点按每次击杀各自的位置写：几次击杀的中心点可能落在它们之间的另一个区域里。
      const places = [...new Set(fight.killPoints.map((point) => zone(point)))]
      const where = places.length
        ? `${places.join('、')}${places.length > 1 ? '一带' : ''}`
        : zone(fight.point)
      // 被处决的人不算任何一方的人头，和「全场击杀」「逐分钟数据」的算法一致。
      const enemyExecutions = fight.enemyExecutions ?? 0
      const allyExecutions = fight.allyExecutions ?? 0
      const executed = [
        enemyExecutions ? `敌方 ${enemyExecutions} 人` : '',
        allyExecutions ? `我方 ${allyExecutions} 人` : ''
      ].filter(Boolean)
      return `第 ${index + 1} 场 ${clock(fight.start)}–${clock(fight.end)} ${where}：我方击杀 ${
        fight.kills - enemyExecutions
      }、敌方击杀 ${fight.deaths - allyExecutions}${
        executed.length ? `，另有${executed.join('、')}被处决` : ''
      }；卷入 我方 ${fight.allies} 名、敌方 ${fight.enemies} 名；${ownPart}${
        after.length ? `；此后 60 秒：${after.join('、')}` : ''
      }。`
    }),
    '没有符合条件的交战。'
  )

  // ── 视野 ──────────────────────────────────────────────────────────────
  const phases = [
    ['0–10 分钟', 0, 600_000],
    ['10–20 分钟', 600_000, 1_200_000],
    ['20 分钟后', 1_200_000, Number.POSITIVE_INFINITY]
  ] as const
  const wardCounts = (events: ReviewReport['vision']['placed']) => {
    const counts = new Map<string, number>()
    for (const event of events) counts.set(event.wardType, (counts.get(event.wardType) ?? 0) + 1)
    return [...counts.entries()].map(([type, count]) => `${WARD[type] ?? type} ${count}`).join('、')
  }
  add('视野（只计饰品眼、辅助眼、控制守卫和远见改造）', [
    ...phases.map(([label, from, to]) => {
      const placed = report.vision.placed.filter(
        (ward) => ward.timestamp >= from && ward.timestamp < to
      )
      const cleared = report.vision.cleared.filter(
        (ward) => ward.timestamp >= from && ward.timestamp < to
      )
      return `${label}：放置 ${placed.length}${placed.length ? `（${wardCounts(placed)}）` : ''}，清除 ${cleared.length}。`
    }),
    `全局：视野得分 ${whole(own.visionScore)}${
      opponent ? `（对位 ${whole(opponent.visionScore)}）` : ''
    }。`
  ])

  // ── 逐分钟 ────────────────────────────────────────────────────────────
  // 时间线每分钟一次的快照原样列出：前面的检查点只取了每 5 分钟，这里是全部。
  const minutes = buildReviewMinuteRows(match)
  const count = (value: number | null, unit: string) =>
    `${value === null ? '?' : Math.round(value)}${unit}`
  // 死活按击杀记录判断，不按血量：尸体的血量不一定是 0（见 analysis.ts 的 settleAlive）。
  const health = (side: {
    health: number | null
    healthMax: number | null
    alive: boolean | null
  }) =>
    side.alive === false
      ? '阵亡'
      : side.health === null || side.healthMax === null
        ? '血?'
        : `血${Math.round(side.health)}/${Math.round(side.healthMax)}`
  const unknownSide = { health: null, healthMax: null, alive: null }
  const hasOpponent = meta.opponentId !== null
  add(
    '逐分钟数据（每行是那一分钟快照时的数；经济、补刀、伤害、承伤、人头是累计值，血量是那一刻的；「?」表示快照里没有这个数）',
    minutes.length
      ? [
          `每行依次是：时间｜本人 经济、身上还没花的金币、补刀、等级、血量/上限、累计对英雄伤害、累计承受伤害（「受」，含小兵、野怪和防御塔打的）、击杀-死亡-助攻${
            hasOpponent
              ? '｜对位 经济、补刀、等级、血量/上限、累计对英雄伤害、累计承受伤害｜本人减对位的经济差、补刀差'
              : ''
          }｜团队经济差（我方减敌方）｜人头 我方:敌方。血量那一格写「阵亡」表示快照那一刻是死的（按击杀记录判断）。人头只数被英雄击杀的，被防御塔、小兵或野怪处决的不算（官方的队伍击杀数会把处决算给对面，所以可能比这里多）。和快照同一秒的事件不一定已经算进这一行。「身上」是那一刻手里的金币，卖装备退回的钱也在里面，所以「经济减去身上」和战绩里的「已花金币」对不上是正常的。`,
          ...minutes.map((row) =>
            [
              clock(row.timestamp),
              `本人 ${count(row.own.gold, '金')} 身上${count(row.own.unspentGold, '')} ${count(row.own.cs, '刀')} ${count(row.own.level, '级')} ${health(row.own)} ${count(row.own.damage, '伤')} 受${count(row.own.damageTaken, '')} ${row.kills}-${row.deaths}-${row.assists}`,
              ...(hasOpponent
                ? [
                    `对位 ${count(row.opponent?.gold ?? null, '金')} ${count(row.opponent?.cs ?? null, '刀')} ${count(row.opponent?.level ?? null, '级')} ${health(row.opponent ?? unknownSide)} ${count(row.opponent?.damage ?? null, '伤')} 受${count(row.opponent?.damageTaken ?? null, '')}`,
                    `差 ${row.goldDiff === null ? '?' : signed(row.goldDiff)}金 ${row.csDiff === null ? '?' : signed(row.csDiff)}刀`
                  ]
                : []),
              `团队 ${row.teamGoldDiff === null ? '?' : signed(row.teamGoldDiff)}`,
              `人头 ${row.ownTeamKills}:${row.enemyTeamKills}`
            ].join('｜')
          )
        ]
      : [],
    '时间线里没有可用的分钟快照。'
  )

  // 十个人每分钟所在的区域，顺序与「对局概况」里的阵容一致。
  const ordered = [...match.participants].sort(
    (a, b) =>
      Number(b.teamId === meta.teamId) - Number(a.teamId === meta.teamId) ||
      roleOrder(a.position) - roleOrder(b.position) ||
      a.participantId - b.participantId
  )
  const orderIndex = ordered.map((participant) =>
    match.participants.findIndex((entry) => entry.participantId === participant.participantId)
  )
  const ownCount = ordered.filter((participant) => participant.teamId === meta.teamId).length
  const lineup = (members: typeof ordered) =>
    members
      .map(
        (participant) =>
          `${POSITION[participant.position]} ${names.champion(participant.championId)}${
            participant.participantId === meta.participantId ? '（本人）' : ''
          }`
      )
      .join('、')
  const placed = minutes.filter((row) => row.places.some((place) => place.zone !== null))
  // 每一格前面都标出是谁，免得靠数第几个来认人；地名与击杀、阵亡那几个分区用同一套。
  const tags = ordered.map((participant) =>
    participant.participantId === meta.participantId ? '本人' : ROLE_TAG[participant.position]
  )
  add(
    '逐分钟位置（快照那一刻每个人所在的区域；只是一个瞬间，不代表这一分钟都在那里）',
    placed.length && ordered.length
      ? [
          '区域一律从本人一方的视角命名，敌方那一半的格子也一样：「己方」「敌方」指地图的哪一半，所以敌方英雄写着「己方上半野区」就是进了我方的野区。「阵亡」表示快照那一刻是死的，「未知」表示快照里没有位置。',
          `每行依次是：时间｜我方 ${lineup(ordered.slice(0, ownCount))}｜敌方 ${lineup(ordered.slice(ownCount))}。每格前面的字是位置：上 = 上单、野 = 打野、中 = 中单、下 = 下路、辅 = 辅助，本人的那一格写「本人」。`,
          ...placed.map((row) => {
            const cells = orderIndex.map((index, order) => {
              const place = row.places[index]
              const where = !place
                ? '未知'
                : place.alive === false
                  ? '阵亡'
                  : place.zone
                    ? ZONE[place.zone]
                    : '未知'
              return `${tags[order]} ${where}`
            })
            return `${clock(row.timestamp)}｜${cells.slice(0, ownCount).join('、')}｜${cells.slice(ownCount).join('、')}`
          })
        ]
      : [],
    '时间线里没有位置记录。'
  )

  // ── 官方挑战统计 ───────────────────────────────────────────────────────
  if (own.challenges) {
    const challenges = own.challenges
    const listed = COACH_CHALLENGES.filter(
      ([key]) =>
        key in challenges &&
        !CHALLENGE_NOT_WRITTEN.has(key) &&
        !(CHALLENGE_SKIP_ZERO.has(key) && challenges[key] === 0)
    )
    add(
      '官方挑战统计（服务器自己的计数，怎么算由官方决定、没有公开说明；和上面按事件数出来的数对不上时，以上面的为准，这里只当旁证）',
      [
        listed.length
          ? listed
              .map(
                ([key, label]) =>
                  `${label} ${
                    CHALLENGE_SHARES.has(key) ? percent(challenges[key]) : decimal(challenges[key])
                  }`
              )
              .join('；') + '。'
          : null
      ]
    )
  }

  // ── 关键片段 ───────────────────────────────────────────────────────────
  // 片段的说明只说「对位经济差增加了多少」，看不出是谁在领先；把前后的差值连同主语一起写出来。
  const swing = (moment: ReviewMatch['moments'][number]) =>
    moment.scope === null || moment.before === null || moment.after === null
      ? ''
      : `（${moment.scope === 'personal' ? '本人减对位的经济差' : '我方减敌方的团队经济差'}：${signed(
          moment.before
        )} → ${signed(moment.after)}）`
  add(
    '程序标出的关键片段（按经济波动、连续阵亡、阵亡后丢资源等规则找出的提示，不是结论）',
    match.moments.map(
      (moment) =>
        `${clock(moment.start)}–${clock(moment.end)} ${moment.title}：${moment.description}${swing(moment)}`
    ),
    '按现有规则没有标出关键片段。'
  )

  // ── 与平时的对比 ───────────────────────────────────────────────────────
  if (input.baseline && match.digest) {
    const baseline = input.baseline
    const rows = compareToReviewBaseline(match.digest, baseline)
    const scopeText = {
      matchup: `同英雄同位置同对位（${names.champion(meta.championId)} ${POSITION[meta.position]} 对 ${
        meta.opponentChampionId === null ? '未知' : names.champion(meta.opponentChampionId)
      }）`,
      champion: `同英雄同位置（${names.champion(meta.championId)} ${POSITION[meta.position]}）`,
      position: `同位置的所有英雄（${POSITION[meta.position]}）`
    }[baseline.scope]
    // 平时的时间不是这一局的时刻，写成「几分几秒」，不写成能点的钟点。
    const describe = (row: ReviewBaselineRow) =>
      `${REVIEW_DIGEST_METRIC_LABELS[row.key]}：本局 ${formatBaselineValue(row, row.value)}，平时中位数 ${formatBaselineValue(
        row,
        row.median,
        true
      )}（中间一半的对局在 ${formatBaselineValue(row, row.q1, true)} 到 ${formatBaselineValue(row, row.q3, true)} 之间，${row.samples} 局）`
    const verdictText = {
      better: '比平时好',
      worse: '比平时差',
      neutral: '与平时不同（无好坏之分）'
    }
    // 任何一局都会有一半的数字落在「中间一半」之外，所以只把排在九成对局之外的单独列出；
    // 样本少时这样的项目仍然很多，按偏离的幅度排序，只逐项写出最突出的几项。
    const allExtreme = rows
      .filter((row) => row.extreme)
      .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))
    const extreme = allExtreme.slice(0, REVIEW_COACH_MAX_EXTREME_ROWS)
    const moreExtreme = allExtreme.slice(REVIEW_COACH_MAX_EXTREME_ROWS)
    const leaning = rows.filter((row) => row.band !== 'typical' && !row.extreme)
    const typical = rows.filter((row) => row.band === 'typical')
    const brief = (row: ReviewBaselineRow) =>
      `${REVIEW_DIGEST_METRIC_LABELS[row.key]} ${formatBaselineValue(row, row.value)}（平时 ${formatBaselineValue(row, row.median, true)}）`
    add(
      `与本人平时的对比（样本：本机档案里${scopeText}的另外 ${baseline.games} 局，其中 ${baseline.wins} 胜；不是完整战绩）`,
      [
        `读法：这里只说明这一局和平时哪里不一样，不说明原因。样本只有 ${baseline.games} 局，单独一项偏离可能只是偶然，几项指向同一件事才值得重视；反过来，几项也可能说的是同一件事（一次被杀会同时拉开等级差、经验差和到 6 级的先后），不要当成几个独立的问题。平时的时间写成「几分几秒」，它们不是这一局的时刻。`,
        '几项的算法：带「交战」的几项沿用「交战」那一节的规则，单独的一次击杀不算交战，所以干净的单杀不会让「打赢的交战数」增加；「在己方第一个阵亡」把我方只有本人一个被记上的交战也算在内。「主动回城」两项不算紧接在阵亡之后的购物。',
        extreme.length
          ? '最突出的项目（比这些对局里至少九成都高，或都低；按偏离幅度从大到小）：'
          : '没有哪一项落在这些对局的最高或最低一档。',
        ...extreme.map(
          (row) => `- ${describe(row)} → ${verdictText[row.verdict as keyof typeof verdictText]}。`
        ),
        moreExtreme.length
          ? `同样处在最高或最低一档、幅度较小的项目：${moreExtreme.map(brief).join('；')}。`
          : null,
        leaning.length
          ? `略高于平时的项目：${
              leaning
                .filter((row) => row.band === 'above')
                .map(brief)
                .join('；') || '无'
            }。`
          : null,
        leaning.length
          ? `略低于平时的项目：${
              leaning
                .filter((row) => row.band === 'below')
                .map(brief)
                .join('；') || '无'
            }。`
          : null,
        // 落在中间一半里的项目只说有多少项：逐个列出来有几十条，说的都是「没什么不同」。
        typical.length ? `其余 ${typical.length} 项落在平时中间一半的范围里，不逐个列出。` : null
      ]
    )
  } else {
    add('与本人平时的对比', [
      '本机档案里可比的对局不足 5 局，没有平时水平可以对比；不要凭空假设这名玩家的平时表现。'
    ])
  }

  // ── 近期状态 ───────────────────────────────────────────────────────────
  // 没有记录时也留下这一节并写明没有，免得被当成「没提就是正常」，或者自己编一个连败出来。
  const form = input.form
  add(
    form ? '近期排位状态（来自本机的上分日志）' : '近期排位状态',
    form
      ? [
          form.rank ? `当前段位：${form.rank}。` : null,
          form.recent?.games
            ? `最近 ${form.recent.games} 场计入胜负的排位：${form.recent.wins} 胜 ${
                form.recent.games - form.recent.wins
              } 负。`
            : null,
          form.streak ? `目前 ${form.streak.length} 连${form.streak.win ? '胜' : '败'}。` : null,
          form.lpDelta === null ? null : `这一局的胜点变化：${signed(form.lpDelta)}。`,
          form.sessionIndex === null
            ? null
            : `这一局是连着打的第 ${form.sessionIndex} 局${
                form.lossesBefore ? `，开打前已经连败 ${form.lossesBefore} 场` : ''
              }。`
        ]
      : [],
    '没有：本机的上分日志里没有可用的记录，段位、连胜连败和胜点变化都不知道，不要提。'
  )

  // ── 对线心得 ───────────────────────────────────────────────────────────
  add(
    '这个对位的对线心得（程序内置的通用笔记，仅供对照，不是这一局的事实）',
    input.tips.map((tip) => `- ${tip}`)
  )

  // ── 别人怎么带、自己以往怎么带 ────────────────────────────────────────
  if (input.statistics)
    add(
      '同段位统计（来自 OP.GG；说的是别人怎么带、带了之后胜率多少，只是相关，不是因果）',
      statisticsLines(loadout, input.statistics)
    )
  else
    add('同段位统计', [
      '这一次没有取到同段位的统计（来源连不上，或者它没有这个英雄这个位置的数据）。评价符文、召唤师技能和出装时不要引用使用率和胜率，也不要自己估一个。'
    ])
  if (input.history)
    add(
      '本人以往的带法（本机档案里的对局，不是完整战绩；局数少，只能当线索）',
      historyLines(loadout, input.history)
    )
  else
    add('本人以往的带法', ['本机档案里没有本人用这个英雄打这个位置的其它对局，看不出以往带什么。'])

  // ── 符文说明书 ─────────────────────────────────────────────────────────
  add(
    '符文一览（现在的客户端里的全部符文，按系和行排列；说要换哪颗符文时，只从这里面选）',
    runeCatalogueLines(loadout)
  )

  // ── 数据局限 ───────────────────────────────────────────────────────────
  add('这份资料不包含的东西', [
    '位置只有每分钟一次的快照（见「逐分钟位置」），加上击杀、资源这些事件自带的坐标；看不到分钟之内的走位。',
    '没有技能是否命中、技能和召唤师技能当时在不在冷却、每次使用的时刻（只有整局的施放次数）、蓝量和能量；血量只有每分钟快照那一刻的数；没有视野范围、兵线位置与状态。',
    '符文只有整局的结算数字，没有每次触发的时间；除了击杀记录里的伤害清单，没有逐次交手的伤害明细。',
    '没有语音和聊天，信号只有次数，也看不到队友和对手的意图。',
    '技能急速、固定护甲穿透这类属性时间线没有记录；装备的主动效果用没用、什么时候用的也没有。',
    catalogue
      ? '符文、装备、召唤师技能和英雄技能的说明取自现在的客户端；这一局如果是更早的版本，当时的数值可能不一样。说明里的「若干」「一定比例」是客户端没有给出具体数字的地方，不是很小的意思。'
      : '这一次没有取到客户端里符文、装备和召唤师技能的说明文字，资料里只有它们的名字。'
  ])

  return finish(sections)
}

function finish(sections: Array<{ title: string; lines: string[] }>): ReviewCoachContext {
  return {
    text: sections
      .map((section) => `## ${section.title}\n${section.lines.join('\n')}`)
      .join('\n\n'),
    sections: sections.map((section) => section.title)
  }
}
