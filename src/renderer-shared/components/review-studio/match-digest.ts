import { REVIEW_FIRST_SHOP_AFTER_MS } from './match-facts'
import { REVIEW_CHALLENGE_KEYS } from './match-report'
import type {
  ReviewDigest,
  ReviewMatch,
  ReviewObjectiveKind,
  ReviewPlayerLine,
  ReviewReport
} from './types'

// [lolps] 单局摘要数字：供跨局平均与个人基线使用。无法证明的数值保持 null，绝不补 0。
const DIGEST_CHECKPOINT_MINUTES = [5, 10, 15, 20] as const
const EPIC_KINDS: ReviewObjectiveKind[] = ['dragon', 'elder', 'herald', 'grubs', 'baron', 'atakhan']

type CheckpointMetricKey =
  `${'cs' | 'goldDiff' | 'csDiff' | 'xpDiff' | 'levelDiff'}${(typeof DIGEST_CHECKPOINT_MINUTES)[number]}`

const CHECKPOINT_METRIC_KEYS = DIGEST_CHECKPOINT_MINUTES.flatMap((minute) => [
  `cs${minute}`,
  `goldDiff${minute}`,
  `csDiff${minute}`,
  `xpDiff${minute}`,
  `levelDiff${minute}`
]) as CheckpointMetricKey[]

const PLAIN_METRIC_KEYS = [
  'kills',
  'deaths',
  'assists',
  'level',
  'cs',
  'csPerMinute',
  'gold',
  'goldPerMinute',
  'damage',
  'damagePerMinute',
  'damageTaken',
  'damageTakenPerMinute',
  'damageShare',
  'damageTakenShare',
  'goldShare',
  'killParticipation',
  'visionScore',
  'visionPerMinute',
  'wardsPlaced',
  'wardsKilled',
  'controlWardsBought',
  'secondsDead',
  'deadShare',
  'unspentGold',
  'summoner1Casts',
  'summoner2Casts',
  'ultimateCasts',
  'csDiffEnd',
  'goldDiffEnd',
  'damageDiffEnd',
  'visionDiffEnd',
  'levelDiffEnd',
  'level2Lead',
  'level6At',
  'level6Lead',
  'level11At',
  'level16At',
  'firstCoreAt',
  'secondCoreAt',
  'thirdCoreAt',
  'bootsAt',
  'firstRecallAt',
  'recalls',
  'takedowns',
  'soloKills',
  'soloDeaths',
  'executions',
  'firstBloodTakedown',
  'fights',
  'fightsJoined',
  'fightsWon',
  'fightsLost',
  'fightsDiedFirst',
  'deathsInFights',
  'deathsOutsideFights',
  'epicOwn',
  'epicEnemy',
  'epicCredited',
  'towersOwn',
  'towersEnemy',
  'towersCredited',
  'enemyObjectivesAfterDeath',
  'wardEvents',
  'controlWardsPlaced',
  'wardsCleared'
] as const

export type ReviewDigestMetricKey = (typeof PLAIN_METRIC_KEYS)[number] | CheckpointMetricKey

/** Every numeric key a digest may carry; archives drop anything else. */
export const REVIEW_DIGEST_METRIC_KEYS: readonly ReviewDigestMetricKey[] = [
  ...PLAIN_METRIC_KEYS,
  ...CHECKPOINT_METRIC_KEYS
]

const diff = (a: number | null | undefined, b: number | null | undefined) =>
  a != null && b != null ? a - b : null

/** Reduces a freshly parsed match to the numbers kept in the archive. Needs `match.report`. */
export function digestReviewMatch(match: ReviewMatch): ReviewDigest | null {
  const report: ReviewReport | null | undefined = match.report
  if (!report) return null
  const { meta } = match
  const line = (id: number | null): ReviewPlayerLine | null =>
    id === null ? null : (report.players.find((player) => player.participantId === id) ?? null)
  const own = line(meta.participantId)
  if (!own) return null
  const opponent = line(meta.opponentId)
  const minutes = meta.gameDuration / 60
  const perMinute = (value: number | null) =>
    value !== null && minutes > 0 ? value / minutes : null
  // 事件不完整时，由事件数出来的次数只是下限，一律留空。
  const count = (value: number) => (report.complete ? value : null)
  const metrics: Record<string, number | null> = {}
  const set = (key: ReviewDigestMetricKey, value: number | null) => {
    metrics[key] = value
  }

  set('kills', own.kills)
  set('deaths', own.deaths)
  set('assists', own.assists)
  set('level', own.level)
  set('cs', own.cs)
  set('csPerMinute', perMinute(own.cs))
  set('gold', own.gold)
  set('goldPerMinute', perMinute(own.gold))
  set('damage', own.damage)
  set('damagePerMinute', perMinute(own.damage))
  set('damageTaken', own.damageTaken)
  set('damageTakenPerMinute', perMinute(own.damageTaken))
  set('damageShare', own.damageShare)
  set('damageTakenShare', own.damageTakenShare)
  set('goldShare', own.goldShare)
  set('killParticipation', own.killParticipation)
  set('visionScore', own.visionScore)
  set('visionPerMinute', perMinute(own.visionScore))
  set('wardsPlaced', own.wardsPlaced)
  set('wardsKilled', own.wardsKilled)
  set('controlWardsBought', own.controlWardsBought)
  set('secondsDead', own.secondsDead)
  set(
    'deadShare',
    own.secondsDead !== null && meta.gameDuration > 0 ? own.secondsDead / meta.gameDuration : null
  )
  const unspent = diff(own.gold, own.goldSpent)
  set('unspentGold', unspent !== null && unspent >= 0 ? unspent : null)
  set('summoner1Casts', own.casts.summoner1)
  set('summoner2Casts', own.casts.summoner2)
  set('ultimateCasts', own.casts.r)

  set('csDiffEnd', diff(own.cs, opponent?.cs))
  set('goldDiffEnd', diff(own.gold, opponent?.gold))
  set('damageDiffEnd', diff(own.damage, opponent?.damage))
  set('visionDiffEnd', diff(own.visionScore, opponent?.visionScore))
  set('levelDiffEnd', diff(own.level, opponent?.level))

  for (const minute of DIGEST_CHECKPOINT_MINUTES) {
    const checkpoint = report.checkpoints.find((candidate) => candidate.minute === minute)
    set(`cs${minute}`, checkpoint?.own?.cs ?? null)
    set(`goldDiff${minute}`, checkpoint?.goldDiff ?? null)
    set(`csDiff${minute}`, checkpoint?.csDiff ?? null)
    set(`xpDiff${minute}`, checkpoint?.xpDiff ?? null)
    set(`levelDiff${minute}`, checkpoint?.levelDiff ?? null)
  }

  const levelAt = (level: number) => report.levels.find((timing) => timing.level === level) ?? null
  // 正值表示比对位更早到达该等级。
  const lead = (level: number) => {
    const timing = levelAt(level)
    return report.complete ? diff(timing?.opponent, timing?.own) : null
  }
  set('level2Lead', lead(2))
  set('level6At', report.complete ? (levelAt(6)?.own ?? null) : null)
  set('level6Lead', lead(6))
  set('level11At', report.complete ? (levelAt(11)?.own ?? null) : null)
  set('level16At', report.complete ? (levelAt(16)?.own ?? null) : null)

  // 物品库认不出任何一件已购物品时，无法断言哪件是成装。
  const catalogueKnown =
    report.complete && report.build.purchases.every((purchase) => purchase.kind !== null)
  const core = report.build.coreItems
  set('firstCoreAt', catalogueKnown ? (core[0]?.timestamp ?? null) : null)
  set('secondCoreAt', catalogueKnown ? (core[1]?.timestamp ?? null) : null)
  set('thirdCoreAt', catalogueKnown ? (core[2]?.timestamp ?? null) : null)
  set('bootsAt', catalogueKnown ? (report.build.boots?.timestamp ?? null) : null)
  const recalls = report.build.visits.filter(
    (visit) => !visit.afterDeath && visit.timestamp >= REVIEW_FIRST_SHOP_AFTER_MS
  )
  set('firstRecallAt', report.complete ? (recalls[0]?.timestamp ?? null) : null)
  set('recalls', count(recalls.length))

  const deaths = match.deaths ?? []
  set('takedowns', count(report.takedowns.length))
  set(
    'soloKills',
    count(report.takedowns.filter((takedown) => takedown.kill && takedown.allies === 0).length)
  )
  set(
    'soloDeaths',
    count(deaths.filter((death) => death.killer !== null && death.assists.length === 0).length)
  )
  set('executions', count(deaths.filter((death) => death.killer === null).length))
  set('firstBloodTakedown', count(report.takedowns.some((takedown) => takedown.firstBlood) ? 1 : 0))

  const joined = report.fights.filter(
    (fight) => fight.ownKills + fight.ownAssists > 0 || fight.ownDeathOrder !== null
  )
  set('fights', count(report.fights.length))
  set('fightsJoined', count(joined.length))
  set('fightsWon', count(joined.filter((fight) => fight.kills > fight.deaths).length))
  set('fightsLost', count(joined.filter((fight) => fight.kills < fight.deaths).length))
  set('fightsDiedFirst', count(joined.filter((fight) => fight.ownDeathOrder === 1).length))
  set('deathsInFights', count(report.deaths.filter((death) => death.fight !== null).length))
  set('deathsOutsideFights', count(report.deaths.filter((death) => death.fight === null).length))

  const epic = report.objectives.filter((objective) => EPIC_KINDS.includes(objective.kind))
  const towers = report.objectives.filter((objective) => objective.kind === 'tower')
  set('epicOwn', count(epic.filter((objective) => objective.own === true).length))
  set('epicEnemy', count(epic.filter((objective) => objective.own === false).length))
  set(
    'epicCredited',
    count(epic.filter((objective) => objective.own === true && objective.credited).length)
  )
  set('towersOwn', count(towers.filter((objective) => objective.own === true).length))
  set('towersEnemy', count(towers.filter((objective) => objective.own === false).length))
  set(
    'towersCredited',
    count(towers.filter((objective) => objective.own === true && objective.credited).length)
  )
  set(
    'enemyObjectivesAfterDeath',
    count(
      report.objectives.filter(
        (objective) => objective.own === false && objective.sinceDeath !== null
      ).length
    )
  )
  set('wardEvents', count(report.vision.placed.length))
  set(
    'controlWardsPlaced',
    count(report.vision.placed.filter((ward) => ward.wardType === 'CONTROL_WARD').length)
  )
  set('wardsCleared', count(report.vision.cleared.length))

  let challenges: Record<string, number> | null = null
  if (own.challenges) {
    challenges = {}
    for (const key of REVIEW_CHALLENGE_KEYS)
      if (key in own.challenges) challenges[key] = own.challenges[key]
  }

  return {
    metrics,
    coreItems: catalogueKnown ? core.slice(0, 3).map((item) => ({ ...item })) : [],
    bootsItemId: catalogueKnown ? (report.build.boots?.itemId ?? null) : null,
    keystone: own.runes?.perks[0] ?? null,
    summonerSpells: [...own.summonerSpells],
    skillPriority: report.build.skillPriority ? [...report.build.skillPriority] : null,
    challenges
  }
}
