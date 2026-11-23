import {
  type ReviewBaseline,
  type ReviewBaselineRow,
  type ReviewMetricUnit,
  compareToReviewBaseline
} from './baseline'
import { classifyReviewDeathZone } from './death-map'
import type { ReviewDigestMetricKey } from './match-digest'
import { REVIEW_FIRST_SHOP_AFTER_MS } from './match-facts'
import { REVIEW_CHALLENGE_KEYS } from './match-report'
import { buildReviewLaneGoldDiffs, buildReviewMinuteRows } from './minute-table'
import type {
  ReviewDamageSource,
  ReviewMatch,
  ReviewObjective,
  ReviewPlayerLine,
  ReviewPoint,
  ReviewPosition,
  ReviewReport
} from './types'

// [lolps] 教练资料包：把一局的完整事实、本人的平时水平和近期状态整理成一份文字资料。
// 这是 AI 教练能看到的全部内容，所以只写记录下来的事实，缺的就写「未知」，不补不猜。
// 资料里不出现任何玩家的名字或账号标识，只用英雄和位置指代。
// 资料固定用中文书写：它是给模型读的，不是界面文字；回答用什么语言由提示词决定。

/** Names as the client shows them; the builder never looks anything up by itself. */
export interface ReviewCoachNames {
  champion(id: number): string
  item(id: number): string
  perk(id: number): string
  spell(id: number): string
  queue(id: number): string
}

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
}

/** 逐项展开写的「最突出项目」最多这么多条，其余只列数值。 */
export const REVIEW_COACH_MAX_EXTREME_ROWS = 12

export interface ReviewCoachContext {
  text: string
  /** Section titles in order, for display and tests. */
  sections: string[]
}

const POSITION: Record<ReviewPosition, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助',
  UNKNOWN: '位置未知'
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

/** 逐分钟位置表里每一格前面标的位置。 */
const ROLE_TAG: Record<ReviewPosition, string> = {
  TOP: '上',
  JUNGLE: '野',
  MIDDLE: '中',
  BOTTOM: '下',
  UTILITY: '辅',
  UNKNOWN: '?'
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

const ROLE_ORDER: ReviewPosition[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN']
const roleOrder = (position: ReviewPosition) => ROLE_ORDER.indexOf(position)

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
  turretPlatesTaken: '参与拿下镀层',
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
  unspentGold: '局末未花金币',
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
  firstRecallAt: '第一次回城补给时间',
  recalls: '回城补给次数',
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

const clock = (timestamp: number) => {
  const seconds = Math.max(0, Math.round(timestamp / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
const whole = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '未知' : String(Math.round(value))
const signed = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? '未知'
    : `${Math.round(value) > 0 ? '+' : ''}${Math.round(value)}`
const percent = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '未知' : `${Math.round(value * 100)}%`
const decimal = (value: number) => String(Number(value.toFixed(1)))

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

/** Level leads are stored in milliseconds; everything else in a diff unit is a plain amount. */
function formatBaselineValue(row: Pick<ReviewBaselineRow, 'key' | 'unit'>, value: number) {
  if (row.key === 'level2Lead' || row.key === 'level6Lead') {
    const seconds = Math.round(value / 1000)
    return seconds === 0 ? '同时' : `${seconds > 0 ? '早' : '晚'} ${Math.abs(seconds)} 秒`
  }
  return formatReviewMetric(value, row.unit)
}

export function buildReviewCoachContext(input: ReviewCoachContextInput): ReviewCoachContext {
  const { match, names } = input
  const { meta, quality } = match
  const report = match.report ?? null
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
  const itemList = (ids: readonly number[]) =>
    ids.length ? ids.map((id) => names.item(id)).join('、') : '无'

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
    match.participants.length ? `${color(100)}（${side(100)}）：${roster(100)}。` : null,
    match.participants.length ? `${color(200)}（${side(200)}）：${roster(200)}。` : null,
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

  add('本人的补充数据', [
    `伤害构成：物理 ${whole(own.physicalDamage)}、魔法 ${whole(own.magicDamage)}、真实 ${whole(own.trueDamage)}；对防御塔 ${whole(own.turretDamage)}、对地图目标 ${whole(own.objectiveDamage)}。`,
    `承伤 ${whole(own.damageTaken)}，另外减免 ${whole(own.damageMitigated)}；治疗 ${whole(own.healing)}；控制敌方 ${whole(own.ccSeconds)} 秒。`,
    `野怪补刀 ${whole(own.jungleCs)}；已花金币 ${whole(own.goldSpent)}；阵亡时间合计 ${whole(own.secondsDead)} 秒，最长存活 ${whole(own.longestLife)} 秒；最大连杀 ${whole(own.largestKillingSpree)}。`,
    `放眼 ${whole(own.wardsPlaced)}、排眼 ${whole(own.wardsKilled)}、购买控制守卫 ${whole(own.controlWardsBought)}。`,
    `技能施放次数：Q ${whole(own.casts.q)}、W ${whole(own.casts.w)}、E ${whole(own.casts.e)}、R ${whole(own.casts.r)}；召唤师技能 ${own.summonerSpells
      .map(
        (id, index) =>
          `${names.spell(id)} ${whole(index === 0 ? own.casts.summoner1 : own.casts.summoner2)} 次`
      )
      .join('、')}。`,
    own.runes
      ? `符文：${own.runes.perks.map((id) => names.perk(id)).join('、')}（第一个是基石）。`
      : '符文：未知。',
    `局末装备：${itemList(own.items)}${own.trinket ? `；饰品 ${names.item(own.trinket)}` : ''}。`,
    opponent
      ? `对位的局末装备：${itemList(opponent.items)}；符文基石 ${
          opponent.runes?.perks.length ? names.perk(opponent.runes.perks[0]) : '未知'
        }。`
      : null
  ])

  // ── 队伍资源 ───────────────────────────────────────────────────────────
  add(
    '队伍资源',
    report.teams.map(
      (team) =>
        `${side(team.teamId)}：防御塔 ${whole(team.towers)}、水晶 ${whole(team.inhibitors)}、小龙 ${whole(team.dragons)}${
          team.dragonTypes.length
            ? `（${team.dragonTypes.map((type) => OBJECTIVE_DETAIL[type] ?? type).join('、')}）`
            : ''
        }${team.soul ? `、龙魂 ${SOUL[team.soul] ?? OBJECTIVE_DETAIL[team.soul] ?? team.soul}` : ''}、先锋 ${whole(team.heralds)}、巢虫 ${whole(team.grubs)}、男爵 ${whole(team.barons)}、厄塔汗 ${whole(team.atakhans)}；一血 ${
          team.firstBlood == null ? '未知' : team.firstBlood ? '是' : '否'
        }、一塔 ${team.firstTower == null ? '未知' : team.firstTower ? '是' : '否'}；禁用 ${
          team.bans.length ? team.bans.map((id) => names.champion(id)).join('、') : '无记录'
        }。`
    )
  )

  // ── 对线与节奏 ─────────────────────────────────────────────────────────
  const laneDiffs = buildReviewLaneGoldDiffs(match)
  add('对线与节奏（差值 = 本人 − 对位；取自分钟快照，没有对应快照就是未知）', [
    ...report.checkpoints
      .filter((checkpoint) => checkpoint.timestamp !== null)
      .map(
        (checkpoint) =>
          `${checkpoint.minute} 分钟：本人 经济 ${whole(checkpoint.own?.gold)}、补刀 ${whole(checkpoint.own?.cs)}、等级 ${whole(checkpoint.own?.level)}、累计对英雄伤害 ${whole(checkpoint.own?.damage)}；对位经济差 ${signed(checkpoint.goldDiff)}、补刀差 ${signed(checkpoint.csDiff)}、经验差 ${signed(checkpoint.xpDiff)}、等级差 ${signed(checkpoint.levelDiff)}；团队经济差 ${signed(checkpoint.teamGoldDiff)}。`
      ),
    report.levels.length
      ? `升级时间（本人 / 对位）：${report.levels
          .filter((timing) => [2, 3, 6, 9, 11, 13, 16, 18].includes(timing.level))
          .map(
            (timing) =>
              `${timing.level} 级 ${timing.own === null ? '未到' : clock(timing.own)} / ${
                timing.opponent === null ? '未到或未知' : clock(timing.opponent)
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
  ])

  // ── 出装与技能 ─────────────────────────────────────────────────────────
  add(
    '出装与回城（按一次停留分组；「开局购买」是出门装，「阵亡后」表示这次购物紧接在本人阵亡之后）',
    [
      ...report.build.visits.map(
        (visit, index) =>
          `${clock(visit.timestamp)} ${
            index === 0 && visit.timestamp < REVIEW_FIRST_SHOP_AFTER_MS
              ? '开局购买'
              : visit.afterDeath
                ? '阵亡后'
                : '回城'
          }：${visit.itemIds.length ? itemList(visit.itemIds) : '只有买了又撤销的操作'}`
      ),
      report.build.coreItems.length
        ? `成装完成时间：${report.build.coreItems
            .map((item) => `${names.item(item.itemId)} ${clock(item.timestamp)}`)
            .join('；')}。`
        : '成装完成时间：未知（物品库不可用，或这一局没有做出成装）。',
      report.build.boots
        ? `第一双升级鞋：${names.item(report.build.boots.itemId)} ${clock(report.build.boots.timestamp)}。`
        : null,
      report.build.sales.length
        ? `卖出：${report.build.sales
            .map((sale) => `${clock(sale.timestamp)} ${names.item(sale.itemId)}`)
            .join('；')}。`
        : null
    ]
  )
  add('技能加点', [
    report.build.skills.length
      ? `加点顺序：${report.build.skills.map((skill) => SKILL_SLOT[skill.slot]).join(' ')}。`
      : '加点顺序：时间线没有记录。',
    report.build.skillPriority
      ? `能确定的主加顺序：${report.build.skillPriority.map((slot) => SKILL_SLOT[slot]).join(' > ')}。`
      : null
  ])

  // ── 击杀与助攻 ─────────────────────────────────────────────────────────
  add(
    `击杀与助攻（共 ${report.takedowns.length} 次）`,
    report.takedowns.map(
      (takedown) =>
        `${clock(takedown.timestamp)} ${zone(takedown.point)}：${takedown.kill ? '击杀' : '助攻'} ${who(
          takedown.victim.championId,
          takedown.victim.role
        )}，${takedown.allies ? `另有 ${takedown.allies} 名队友参与` : '没有队友参与（单杀）'}${
          takedown.kill && takedown.bounty !== null
            ? `，击杀金币 ${takedown.bounty}${
                takedown.shutdownBounty ? `，终结赏金 ${takedown.shutdownBounty}` : ''
              }`
            : ''
        }${takedown.firstBlood ? '，一血' : ''}。`
    ),
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
    const slots = [
      ['普攻', source.slots.basic],
      ['被动', source.slots.passive],
      ['Q', source.slots.q],
      ['W', source.slots.w],
      ['E', source.slots.e],
      ['R', source.slots.r],
      ['召唤师技能', source.slots.summoner],
      ['其它', source.slots.other]
    ] as const
    const breakdown = slots
      .filter(([, amount]) => amount > 0)
      .map(([label, amount]) => `${label} ${Math.round(amount)}`)
      .join('、')
    const name =
      source.kind === 'champion' ? who(source.championId, source.role) : SOURCE_KIND[source.kind]
    return `${name} ${Math.round(source.total)}${
      source.kind === 'champion' && breakdown ? `〔${breakdown}〕` : ''
    }`
  }
  const deaths = match.deaths ?? []
  add(
    `阵亡（共 ${report.deaths.length} 次；伤害来源是击杀记录自带的统计，不等于整场交战的全部伤害）`,
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
      return [
        `${clock(detail.timestamp)} ${zone(death?.point ?? null)}：${killers}。`,
        detail.sources.length
          ? `承受伤害 ${whole(detail.damageTaken)}，来源：${detail.sources.map(sourceText).join('；')}。`
          : '这次阵亡没有伤害来源记录。',
        detail.damageDealt === null
          ? detail.sources.length
            ? '击杀记录里没有本人阵亡前打出的伤害（可能没有打出，也可能没有记录）。'
            : ''
          : `阵亡前打出伤害 ${Math.round(detail.damageDealt)}。`,
        detail.level !== null || detail.killerLevel !== null
          ? `当时等级：本人 ${whole(detail.level)}、击杀者 ${whole(detail.killerLevel)}。`
          : '',
        detail.fight === null ? '不在任何一场交战里。' : `属于第 ${detail.fight + 1} 场交战。`,
        detail.bounty ? `送出金币 ${detail.bounty}。` : '',
        after.length ? `此后 90 秒内敌方拿下：${after.join('、')}。` : ''
      ]
        .filter(Boolean)
        .join('')
    }),
    '这一局本人没有阵亡。'
  )

  // ── 地图资源 ───────────────────────────────────────────────────────────
  const proximity = (objective: ReviewObjective) =>
    objective.distance === null
      ? ''
      : objective.distance <= 3000
        ? '，本人在附近'
        : objective.distance >= 7000
          ? '，本人离得很远'
          : '，本人不在附近'
  add(
    '地图资源时间线（「在附近 / 很远」取自最多相差 45 秒的分钟快照，只能说明大致远近）',
    report.objectives.map(
      (objective) =>
        `${clock(objective.timestamp)} ${objectiveName(objective)}：${
          objective.own === null ? '归属未知' : objective.own ? '我方拿下' : '敌方拿下'
        }${objective.credited ? '，本人有参与' : ''}${
          objective.sinceDeath === null
            ? ''
            : `，本人 ${Math.round(objective.sinceDeath / 1000)} 秒前刚阵亡`
        }${proximity(objective)}。`
    ),
    '时间线里没有防御塔、水晶或史诗野怪被拿下的记录。'
  )

  // ── 交战 ──────────────────────────────────────────────────────────────
  add(
    `交战（共 ${report.fights.length} 场；15 秒内、相距不远的击杀归为同一场，是整理规则，不代表游戏里真有一场团战；「卷入」的人数把击杀者、助攻者和被击杀者都算上）`,
    report.fights.map((fight, index) => {
      const after = fight.objectivesAfter
        .map((objectiveIndex) => report.objectives[objectiveIndex])
        .filter(Boolean)
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
      return `第 ${index + 1} 场 ${clock(fight.start)}–${clock(fight.end)} ${where}：我方击杀 ${fight.kills}、敌方击杀 ${fight.deaths}；卷入 我方 ${fight.allies} 名、敌方 ${fight.enemies} 名；${ownPart}${
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
  const hasOpponent = meta.opponentId !== null
  add(
    '逐分钟数据（每行是那一分钟快照时的累计数；「?」表示快照里没有这个数）',
    minutes.length
      ? [
          `每行依次是：时间｜本人 经济、身上还没花的金币、补刀、等级、累计对英雄伤害、击杀-死亡-助攻${
            hasOpponent ? '｜对位 经济、补刀、等级、累计对英雄伤害｜本人减对位的经济差、补刀差' : ''
          }｜团队经济差（我方减敌方）｜人头 我方:敌方。`,
          ...minutes.map((row) =>
            [
              clock(row.timestamp),
              `本人 ${count(row.own.gold, '金')} 身上${count(row.own.unspentGold, '')} ${count(row.own.cs, '刀')} ${count(row.own.level, '级')} ${count(row.own.damage, '伤')} ${row.kills}-${row.deaths}-${row.assists}`,
              ...(hasOpponent
                ? [
                    `对位 ${count(row.opponent?.gold ?? null, '金')} ${count(row.opponent?.cs ?? null, '刀')} ${count(row.opponent?.level ?? null, '级')} ${count(row.opponent?.damage ?? null, '伤')}`,
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
    add('官方挑战统计（服务器自己的计数，口径由官方决定）', [
      REVIEW_CHALLENGE_KEYS.filter((key) => key in challenges)
        .map((key) => `${CHALLENGE[key]} ${decimal(challenges[key])}`)
        .join('；') + '。'
    ])
  }

  // ── 关键片段 ───────────────────────────────────────────────────────────
  add(
    '程序标出的关键片段（按经济波动、连续阵亡、阵亡后丢资源等规则找出的提示，不是结论）',
    match.moments.map(
      (moment) =>
        `${clock(moment.start)}–${clock(moment.end)} ${moment.title}：${moment.description}`
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
    const describe = (row: ReviewBaselineRow) =>
      `${REVIEW_DIGEST_METRIC_LABELS[row.key]}：本局 ${formatBaselineValue(row, row.value)}，平时中位数 ${formatBaselineValue(
        row,
        row.median
      )}（中间一半的对局在 ${formatBaselineValue(row, row.q1)} 到 ${formatBaselineValue(row, row.q3)} 之间，${row.samples} 局）`
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
      `${REVIEW_DIGEST_METRIC_LABELS[row.key]} ${formatBaselineValue(row, row.value)}（平时 ${formatBaselineValue(row, row.median)}）`
    add(
      `与本人平时的对比（样本：本机档案里${scopeText}的另外 ${baseline.games} 局，其中 ${baseline.wins} 胜；不是完整战绩）`,
      [
        `读法：这里只说明这一局和平时哪里不一样，不说明原因。样本只有 ${baseline.games} 局，单独一项偏离可能只是偶然，几项指向同一件事才值得重视。`,
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
        typical.length
          ? `与平时相近的项目：${typical
              .map(
                (row) =>
                  `${REVIEW_DIGEST_METRIC_LABELS[row.key]} ${formatBaselineValue(row, row.value)}`
              )
              .join('；')}。`
          : null
      ]
    )
  } else {
    add('与本人平时的对比', [
      '本机档案里可比的对局不足 5 局，没有平时水平可以对比；不要凭空假设这名玩家的平时表现。'
    ])
  }

  // ── 近期状态 ───────────────────────────────────────────────────────────
  const form = input.form
  if (form) {
    add('近期排位状态（来自本机的上分日志）', [
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
    ])
  }

  // ── 对线心得 ───────────────────────────────────────────────────────────
  add(
    '这个对位的对线心得（程序内置的通用笔记，仅供对照，不是这一局的事实）',
    input.tips.map((tip) => `- ${tip}`)
  )

  // ── 数据局限 ───────────────────────────────────────────────────────────
  add('这份资料不包含的东西', [
    '位置只有每分钟一次的快照（见「逐分钟位置」），加上击杀、资源这些事件自带的坐标；看不到分钟之内的走位。',
    '没有技能是否命中、技能和召唤师技能的冷却、血量蓝量的逐秒变化、视野范围、兵线位置与状态。',
    '没有语音、信号和聊天，也看不到队友和对手的意图。',
    '除本人阵亡时的伤害来源外，没有逐次交手的伤害明细。'
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
