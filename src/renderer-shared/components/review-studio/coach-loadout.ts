import type { ReviewCoachCatalogue } from './coach-catalogue'
import {
  POSITION,
  ROLE_TAG,
  type ReviewCoachNames,
  clock,
  percent,
  percentFine,
  roleOrder,
  whole
} from './coach-format'
import {
  REVIEW_PRIMARY_RUNES,
  REVIEW_STATISTICS_MIN_GAMES,
  type ReviewLoadoutHistory,
  type ReviewLoadoutHistoryGroup,
  type ReviewLoadoutOption,
  type ReviewLoadoutRecord,
  type ReviewLoadoutStatistics,
  type ReviewLoadoutTable,
  type ReviewRuneHistory,
  type ReviewRunePageOption
} from './coach-statistics'
import { formatRuneStatAmount, readRuneStats } from './game-text'
import { REVIEW_FIRST_SHOP_AFTER_MS } from './match-facts'
import type {
  ReviewBuild,
  ReviewMatch,
  ReviewParticipantFrame,
  ReviewPlayerLine,
  ReviewReport,
  ReviewRunes
} from './types'

// [lolps] 教练资料包里和「带什么」有关的几节：符文、召唤师技能、出装、双方的伤害类型、
// 属性快照、英雄技能，加上同段位的统计和本人以往的带法。只写事实和说明书里的原文，
// 好坏留给教练判断。

export interface ReviewLoadoutInput {
  match: ReviewMatch
  report: ReviewReport
  names: ReviewCoachNames
  /** null while the client's game data is not available; texts are then left out. */
  catalogue: ReviewCoachCatalogue | null
}

/** 装备说明最多写这么多件「统计里常见、但双方都没出」的装备。 */
export const REVIEW_COACH_MAX_CANDIDATE_ITEMS = 18
/** 对线双方买过的散件，总价到这个数才写说明：更便宜的只是基础属性。 */
export const REVIEW_COACH_COMPONENT_MIN_PRICE = 1000
/** 其余敌人的局末装备，总价到这个数才写说明：只要成装。 */
export const REVIEW_COACH_ENEMY_ITEM_MIN_PRICE = 2200
/** 一颗符文以往的记录不到这么多局，不给中位数。 */
export const REVIEW_COACH_RUNE_HISTORY_MIN_GAMES = 3

const list = (ids: readonly number[], name: (id: number) => string, joiner = '、') =>
  ids.length ? ids.map(name).join(joiner) : '无'

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
/** A length that is not a moment of the reviewed game, so not written as a clock. */
const minutesAndSeconds = (seconds: number) =>
  `${Math.floor(Math.round(seconds) / 60)} 分 ${Math.round(seconds) % 60} 秒`

/**
 * 客户端里不同的装备可以叫同一个名字（实测：总价 1337 和 1000 的两件都叫「残暴之力」）。
 * 资料里只写名字，会把它们写成同一件，价钱也对不上。同一份资料里出现重名时，在名字后面
 * 标上总价把它们分开；客户端查不到价钱的标编号。
 */
export function disambiguateItemNames(
  names: ReviewCoachNames,
  itemIds: Iterable<number>,
  catalogue: ReviewCoachCatalogue | null
): ReviewCoachNames {
  const idsByName = new Map<string, Set<number>>()
  for (const id of itemIds) {
    const name = names.item(id)
    if (!idsByName.has(name)) idsByName.set(name, new Set())
    idsByName.get(name)!.add(id)
  }
  const shared = new Set(
    [...idsByName.values()].filter((ids) => ids.size > 1).flatMap((ids) => [...ids])
  )
  if (!shared.size) return names
  return {
    ...names,
    item: (id) => {
      const name = names.item(id)
      if (!shared.has(id)) return name
      const price = catalogue?.item(id)?.price
      return `${name}（${price ? `总价 ${price}` : `编号 ${id}`}）`
    }
  }
}

/** Every item id the document may name, for telling same-named items apart. */
export function collectReviewItemIds(
  report: ReviewReport,
  statistics: ReviewLoadoutStatistics | null
): number[] {
  const tables = statistics ? [statistics.general, statistics.versus] : []
  return [
    ...report.players.flatMap((player) => [
      ...player.items,
      ...(player.trinket ? [player.trinket] : []),
      ...(player.roleItem ? [player.roleItem] : [])
    ]),
    ...[report.build, report.opponentBuild].flatMap((build) =>
      build
        ? [
            ...build.purchases.map((purchase) => purchase.itemId),
            ...build.sales.map((s) => s.itemId)
          ]
        : []
    ),
    ...tables.flatMap((table) =>
      table
        ? [...table.starting, ...table.boots, ...table.core, ...table.late].flatMap((o) => o.ids)
        : []
    )
  ]
}

function sortedPlayers(input: ReviewLoadoutInput) {
  const { meta } = input.match
  return [...input.report.players].sort(
    (a, b) =>
      Number(b.teamId === meta.teamId) - Number(a.teamId === meta.teamId) ||
      roleOrder(a.position) - roleOrder(b.position) ||
      a.participantId - b.participantId
  )
}

function playerLabel(input: ReviewLoadoutInput, player: ReviewPlayerLine) {
  const { meta } = input.match
  return `${player.teamId === meta.teamId ? '我方' : '敌方'} ${POSITION[player.position]} ${input.names.champion(
    player.championId
  )}${player.participantId === meta.participantId ? '（本人）' : ''}`
}

function treeName(input: ReviewLoadoutInput, id: number | null) {
  if (id === null) return '未知'
  return input.catalogue?.runeTrees.find((tree) => tree.id === id)?.name ?? `符文系 ${id}`
}

function runePage(input: ReviewLoadoutInput, runes: ReviewRunes) {
  const { names } = input
  const primary = runes.perks.slice(0, runes.primaryCount)
  const secondary = runes.perks.slice(runes.primaryCount)
  return [
    primary.length ? `基石 ${names.perk(primary[0])}` : '基石 未知',
    `主系【${treeName(input, runes.primaryStyle)}】${list(primary.slice(1), names.perk)}`,
    `副系【${treeName(input, runes.subStyle)}】${list(secondary, names.perk)}`,
    `碎片 ${list(runes.shards, names.perk)}`
  ].join('；')
}

// ── 十个人带了什么 ──────────────────────────────────────────────────────

export function rosterLoadoutLines(input: ReviewLoadoutInput): string[] {
  const { names, catalogue } = input
  return sortedPlayers(input).map((player) => {
    const roles = catalogue?.championRoles(player.championId) ?? []
    return `${playerLabel(input, player)}${roles.length ? `〔${roles.join('、')}〕` : ''}：${
      player.runes ? runePage(input, player.runes) : '符文未知'
    }；召唤师技能 ${list(player.summonerSpells, names.spell)}；装备 ${list(player.items, names.item)}${
      player.trinket ? `（饰品 ${names.item(player.trinket)}）` : ''
    }${player.roleItem ? `（位置任务奖励 ${names.item(player.roleItem)}）` : ''}。`
  })
}

// ── 英雄技能 ───────────────────────────────────────────────────────────

/**
 * What the client says the reviewed player's champion and the five enemies can do. Whether
 * the other side heals, shields or locks down is read from here, not from memory.
 */
export function championKitLines(input: ReviewLoadoutInput): string[] {
  const { match, catalogue } = input
  if (!catalogue) return []
  const { meta } = match
  const players = sortedPlayers(input).filter(
    (player) => player.participantId === meta.participantId || player.teamId !== meta.teamId
  )
  const missing: string[] = []
  const lines = players.flatMap((player) => {
    const kit = catalogue.champion(player.championId)
    if (!kit) {
      missing.push(playerLabel(input, player))
      return []
    }
    const roles = catalogue.championRoles(player.championId)
    const traits = [
      roles.length ? roles.join('、') : null,
      kit.attack,
      kit.damage ? `以${kit.damage}伤害为主` : null,
      kit.ratings.length
        ? `客户端的评级（1 到 3）：${kit.ratings.map((rating) => `${rating.label} ${rating.value}`).join('、')}`
        : null
    ].filter(Boolean)
    return [
      `${playerLabel(input, player)}${traits.length ? `〔${traits.join('；')}〕` : ''}`,
      ...kit.abilities.map((ability) => {
        // 充能型技能的冷却是 0，写出来只会误导。
        const cooldown = ability.cooldowns.some((seconds) => seconds > 0)
          ? `（冷却 ${ability.cooldowns.join('/')} 秒）`
          : ''
        return `- ${ability.key} ${ability.name}${cooldown}：${ability.description || '客户端没有给说明'}`
      })
    ]
  })
  // 一个都没取到时整节另有说明；只缺几个时点名，免得缺的那几个被凭记忆补上。
  if (lines.length && missing.length)
    lines.push(`没有取到技能说明的：${missing.join('、')}。这几个英雄的技能不要凭记忆下结论。`)
  return lines
}

// ── 本人的符文 ─────────────────────────────────────────────────────────

/** 同一颗符文在本人以往对局里的记录：每一项的中位数，只算能比的那几项。 */
function runeHistoryText(labels: readonly string[], history: ReviewRuneHistory | undefined) {
  const samples = history?.samples ?? []
  if (samples.length < REVIEW_COACH_RUNE_HISTORY_MIN_GAMES) return ''
  const perGame = samples.map((sample) => readRuneStats(labels, sample.stats))
  const lines = (perGame[0] ?? []).flatMap((stat, index) => {
    if (!stat.amount) return []
    const values = perGame.flatMap((stats) => {
      const amount = stats[index]?.amount
      return amount ? [amount.value] : []
    })
    // 时间是 0 表示那一局没有达成，不能和达成的时间混在一起取中位数。
    const reached = stat.amount.unit === 'seconds' ? values.filter((value) => value > 0) : values
    if (!reached.length) return []
    const text = formatRuneStatAmount(stat, median(reached))
    if (!text) return []
    const missed = values.length - reached.length
    return [`${text}${missed ? `（另有 ${missed} 局没有达成）` : ''}`]
  })
  if (!lines.length) return ''
  return `〔本人以往带这颗符文的 ${samples.length} 局的中位数：${lines.join('；')}；这些局的时长中位数 ${minutesAndSeconds(
    median(samples.map((sample) => sample.duration))
  )}〕`
}

export function ownRuneLines(
  input: ReviewLoadoutInput,
  history: ReviewLoadoutHistory | null = null
): string[] {
  const { match, report, names, catalogue } = input
  const own = report.players.find((player) => player.participantId === match.meta.participantId)
  const runes = own?.runes
  if (!own || !runes?.perks.length) return []

  const tree = (id: number | null) => catalogue?.runeTrees.find((entry) => entry.id === id) ?? null
  const primaryTree = tree(runes.primaryStyle)
  const secondaryTree = tree(runes.subStyle)
  const themed = (id: number | null) => {
    const theme = tree(id)?.theme
    return `【${treeName(input, id)}】${theme ? `（${theme}）` : ''}`
  }
  const row = (entry: typeof primaryTree, id: number) => {
    const index = entry?.rows.findIndex((ids) => ids.includes(id)) ?? -1
    return index >= 0 ? `第 ${index + 1} 行` : ''
  }

  const lines = [
    `主系${themed(runes.primaryStyle)}，副系${themed(runes.subStyle)}。`,
    `对照用的全局数字：时长 ${clock(match.meta.gameDuration * 1000)}；本人对英雄伤害 ${whole(own.damage)}、治疗 ${whole(
      own.healing
    )}、承伤 ${whole(own.damageTaken)}、总经济 ${whole(own.gold)}、击杀加助攻 ${
      own.kills !== null && own.assists !== null ? own.kills + own.assists : '未知'
    } 次。`
  ]
  runes.perks.forEach((id, index) => {
    const primary = index < runes.primaryCount
    const place =
      primary && index === 0
        ? '基石'
        : primary
          ? `主系${row(primaryTree, id)}`
          : `副系${row(secondaryTree, id)}`
    const rune = catalogue?.rune(id)
    const recorded = rune
      ? readRuneStats(rune.statLabels, runes.stats[index] ?? []).map((stat) => stat.text)
      : []
    lines.push(
      `- ${place} ${names.perk(id)}${rune?.long ? `：${rune.long}` : ''}〔${
        recorded.length
          ? `本局记录：${recorded.join('；')}`
          : rune
            ? '这颗符文没有结算数字'
            : '客户端里查不到这颗符文的说明'
      }〕${
        rune
          ? runeHistoryText(
              rune.statLabels,
              history?.runes.find((entry) => entry.id === id)
            )
          : ''
      }`
    )
  })
  if (runes.shards.length)
    lines.push(
      `- 属性碎片：${runes.shards
        .map((id) => {
          const text = catalogue?.rune(id)?.short
          return `${names.perk(id)}${text && text !== names.perk(id) ? `（${text}）` : ''}`
        })
        .join('、')}。`
    )
  return lines
}

/** Every rune of the client, tree by tree, with the reviewed player's picks marked. */
export function runeCatalogueLines(input: ReviewLoadoutInput): string[] {
  const { match, report, names, catalogue } = input
  if (!catalogue?.runeTrees.length) return []
  const trees = catalogue.runeTrees
  const runes = report.players.find(
    (player) => player.participantId === match.meta.participantId
  )?.runes
  const taken = new Set(runes?.perks ?? [])
  const mark = (id: number) => (taken.has(id) ? ' ✔' : '')
  // 每一颗都给全文：只有一句话的概述没有数值，没法和本人带的那颗比。
  const text = (id: number) => {
    const rune = catalogue.rune(id)
    return `${names.perk(id)}${mark(id)}${rune?.long ? `——${rune.long}` : ''}`
  }

  // 系的名字和别的系里某颗符文的名字撞在一起时，说一声，免得看混。
  const collisions = trees.flatMap((tree) =>
    trees
      .filter((other) => other.id !== tree.id)
      .flatMap((other) => [...other.keystones, ...other.rows.flat()])
      .filter((id) => names.perk(id).startsWith(tree.name))
      .map((id) => {
        const home = trees.find((other) => [...other.keystones, ...other.rows.flat()].includes(id))
        return `「${tree.name}」是一个系，「${names.perk(id)}」是【${home?.name ?? ''}】系里的符文`
      })
  )

  const lines = [
    `带法的规则：主系选一个基石，再从该系下面三行里每行选一个；副系从另一个系的三行里选两个，必须在不同的行，不能选基石；属性碎片三行各选一个。带「✔」的是本人这局带的。名字都照客户端原样写${
      collisions.length ? `，注意${collisions.join('，')}` : ''
    }。`
  ]
  for (const tree of trees) {
    lines.push(`【${tree.name}】${tree.theme}`)
    for (const id of tree.keystones) lines.push(`基石：${text(id)}`)
    tree.rows.forEach((ids, index) => lines.push(`第 ${index + 1} 行：${ids.map(text).join('｜')}`))
  }
  const shardRows = trees[0].shardRows
  if (shardRows.length) {
    // 三个碎片都记到了，才知道哪个是哪一行的。
    const ownShards = runes?.shards.length === shardRows.length ? runes.shards : []
    lines.push(
      `属性碎片：${shardRows
        .map(
          (ids, index) =>
            `第 ${index + 1} 行 ${ids
              .map((id) => {
                const short = catalogue.rune(id)?.short
                return `${names.perk(id)}${ownShards[index] === id ? ' ✔' : ''}${
                  short && short !== names.perk(id) ? `（${short}）` : ''
                }`
              })
              .join('｜')}`
        )
        .join('；')}。`
    )
  }
  return lines
}

// ── 召唤师技能 ─────────────────────────────────────────────────────────

/** Ignite in the client's spell list. */
const IGNITE_SPELL_ID = 14

export function spellLines(input: ReviewLoadoutInput): string[] {
  const { match, report, names, catalogue } = input
  const { meta } = match
  const own = report.players.find((player) => player.participantId === meta.participantId)
  if (!own) return []
  const opponent = report.players.find((player) => player.participantId === meta.opponentId)
  const cooldown = (id: number) => {
    const seconds = catalogue?.spell(id)?.cooldown
    return seconds ? `（基础冷却 ${seconds} 秒）` : ''
  }

  const lines = [
    own.summonerSpells.length
      ? `本人：${own.summonerSpells
          .map(
            (id, index) =>
              `${names.spell(id)}${cooldown(id)}这局用了 ${whole(
                index === 0 ? own.casts.summoner1 : own.casts.summoner2
              )} 次`
          )
          .join('；')}。每次是什么时候用的，战绩里没有。`
      : '本人的召唤师技能：未知。'
  ]
  if (own.summonerSpells.includes(IGNITE_SPELL_ID)) {
    const withIgnite = report.takedowns.filter((takedown) => (takedown.damage?.ignite ?? 0) > 0)
    lines.push(
      `点燃的伤害：本人参与的 ${report.takedowns.length} 次击杀里，有 ${withIgnite.length} 次的伤害记录里本人的点燃打出了伤害，合计 ${Math.round(
        withIgnite.reduce((sum, takedown) => sum + takedown.damage!.ignite, 0)
      )}（各次见「击杀与助攻」）。没有换来击杀的点燃没有记录。`
    )
  }
  const teleports = own.challenges?.teleportTakedowns
  if (teleports) lines.push(`官方计数：传送后参与击杀 ${teleports} 次。`)
  if (opponent)
    lines.push(
      `对位 ${names.champion(opponent.championId)}：${list(opponent.summonerSpells, names.spell)}。`
    )
  const available = catalogue?.riftSpells ?? []
  if (available.length) {
    lines.push('峡谷里可以带的召唤师技能（冷却是客户端标的基础值，没有算上召唤师技能急速）：')
    for (const id of available) {
      const spell = catalogue!.spell(id)
      if (!spell) continue
      lines.push(
        `- ${spell.name}${own.summonerSpells.includes(id) ? ' ✔' : ''}${
          spell.cooldown ? `（${spell.cooldown} 秒）` : ''
        }：${spell.description || '客户端没有给说明'}`
      )
    }
  }
  return lines
}

// ── 伤害类型 ───────────────────────────────────────────────────────────

/** How a damage total splits into the three types; null when a part is missing. */
function typeShares(physical: number | null, magic: number | null, trueDamage: number | null) {
  if (physical === null || magic === null || trueDamage === null) return null
  const total = physical + magic + trueDamage
  if (total <= 0) return null
  return `物理 ${percent(physical / total)}、魔法 ${percent(magic / total)}、真实 ${percent(trueDamage / total)}`
}

export function damageTypeLines(input: ReviewLoadoutInput): string[] {
  const { match, report, names } = input
  const { meta } = match
  const own = report.players.find((player) => player.participantId === meta.participantId)
  if (!own) return []
  const taken = typeShares(own.physicalDamageTaken, own.magicDamageTaken, own.trueDamageTaken)
  const team = (ownTeam: boolean) => {
    const players = sortedPlayers(input).filter(
      (player) => (player.teamId === meta.teamId) === ownTeam
    )
    const sum = (pick: (player: ReviewPlayerLine) => number | null) =>
      players.every((player) => pick(player) !== null)
        ? players.reduce((total, player) => total + pick(player)!, 0)
        : null
    const all = typeShares(
      sum((player) => player.physicalDamage),
      sum((player) => player.magicDamage),
      sum((player) => player.trueDamage)
    )
    // 「共」用战绩里的总伤害，和「最终数据」里的数是同一个；三种类型各自取整后相加会差一两点。
    const each = players
      .map((player) => {
        const shares = typeShares(player.physicalDamage, player.magicDamage, player.trueDamage)
        return `${POSITION[player.position]} ${names.champion(player.championId)} ${
          shares ? `${shares}（共 ${whole(player.damage)}）` : '未知'
        }`
      })
      .join('；')
    return `${ownTeam ? '我方' : '敌方'}五人对英雄的伤害：${
      all ? `${all}（共 ${whole(sum((player) => player.damage))}）` : '合计未知'
    }。各人：${each}。`
  }
  return [
    taken
      ? `本人承受的伤害按类型（含小兵、野怪和防御塔打的）：物理 ${whole(own.physicalDamageTaken)}、魔法 ${whole(
          own.magicDamageTaken
        )}、真实 ${whole(own.trueDamageTaken)}，即 ${taken}。`
      : '本人承受的伤害按类型：未知。',
    team(false),
    team(true)
  ]
}

// ── 出装 ──────────────────────────────────────────────────────────────

/** Shop visits, completed items and sales of one player, in the same wording for both sides. */
export function buildLines(
  build: ReviewBuild,
  names: ReviewCoachNames,
  finalItems: readonly number[] = [],
  catalogue: ReviewCoachCatalogue | null = null
): string[] {
  const items = (ids: readonly number[]) => list(ids, names.item)
  const bought = new Set(build.purchases.map((purchase) => purchase.itemId))
  // 局末身上有、却没有购买记录的：别的装备变成的（升级、进化），或者任务、符文给的。
  const unbought = [...new Set(finalItems)].filter((id) => !bought.has(id))
  // 只由一件装备变来、而那件装备整局只从物品栏消失过一次：消失的那一刻就是换上它的时候。
  // 实测 16.23（28 局）：升到三阶的鞋和辅助的任务装都是这样，各 1 条记录；由几件散件变来的
  // （破碎的护腕）记录有多条，分不清，不写时间。
  const becameAt = (id: number) => {
    const from = catalogue?.item(id)?.from ?? []
    const gone = from.length === 1 ? build.destroyed?.[from[0]] : undefined
    return gone?.count === 1 ? { source: from[0], timestamp: gone.timestamp } : null
  }
  const timed = unbought.flatMap((id) => {
    const change = becameAt(id)
    return change ? [{ id, ...change }] : []
  })
  const untimed = unbought.filter((id) => !timed.some((entry) => entry.id === id))
  // 一次停留里可能只卖不买，也可能买卖之后又全部撤销；实测 16.23（714 次停留）两种都有。
  const visitText = (visit: ReviewBuild['visits'][number]) => {
    const sold = visit.soldIds?.length ? `卖出 ${items(visit.soldIds)}` : ''
    if (visit.itemIds.length) return `${items(visit.itemIds)}${sold ? `；${sold}` : ''}`
    return sold ? `没有买东西，只${sold}` : '没有留下买卖（操作之后又撤销了）'
  }
  return [
    ...build.visits.map(
      (visit, index) =>
        `${clock(visit.timestamp)} ${
          index === 0 && visit.timestamp < REVIEW_FIRST_SHOP_AFTER_MS
            ? '开局购买'
            : visit.afterDeath
              ? '阵亡后'
              : '回城'
        }：${visitText(visit)}`
    ),
    build.coreItems.length
      ? `成装完成时间（成装指由散件合成的大件，鞋另算）：${build.coreItems
          .map((item) => `${names.item(item.itemId)} ${clock(item.timestamp)}`)
          .join('；')}。`
      : '成装完成时间：未知（物品库不可用，或这一局没有做出成装）。',
    ...(build.boots
      ? [`第一双升级鞋：${names.item(build.boots.itemId)} ${clock(build.boots.timestamp)}。`]
      : []),
    ...(build.sales.length
      ? [
          `卖出：${build.sales
            .map((sale) => `${clock(sale.timestamp)} ${names.item(sale.itemId)}`)
            .join('；')}。`
        ]
      : []),
    ...(unbought.length
      ? [
          `局末装备里没有购买记录的：${items(unbought)}。它们不是在商店买的，是别的装备变成的，或者任务、符文给的。${
            timed.length
              ? `${timed
                  .map(
                    (entry) =>
                      `${names.item(entry.source)} 在 ${clock(entry.timestamp)} 从物品栏消失，${names.item(entry.id)} 就是那一刻换上的`
                  )
                  .join('；')}。`
              : ''
          }${untimed.length ? `${timed.length ? `${items(untimed)} ` : ''}什么时候得到的，时间线里看不出来。` : ''}`
        ]
      : [])
  ]
}

/** The text of the items that matter for judging the build: both laners', the enemies', the common picks. */
export function itemTextLines(
  input: ReviewLoadoutInput,
  statistics: ReviewLoadoutStatistics | null
): string[] {
  const { match, report, names, catalogue } = input
  if (!catalogue) return []
  const { meta } = match
  const own = report.players.find((player) => player.participantId === meta.participantId)
  const opponent = report.players.find((player) => player.participantId === meta.opponentId)
  // 出门装、鞋、成装都写；散件只写贵的那些，它们看得出往哪个方向出。
  const worth = (purchase: ReviewBuild['purchases'][number]) =>
    purchase.kind === 'core' ||
    purchase.kind === 'boots' ||
    purchase.kind === 'starter' ||
    (purchase.kind === 'component' &&
      (catalogue.item(purchase.itemId)?.price ?? 0) >= REVIEW_COACH_COMPONENT_MIN_PRICE)

  const tags = new Map<number, Set<string>>()
  const tag = (ids: readonly (number | null | undefined)[], label: string) => {
    for (const id of ids) {
      if (!id) continue
      if (!tags.has(id)) tags.set(id, new Set())
      tags.get(id)!.add(label)
    }
  }
  tag(
    [
      ...report.build.purchases.filter(worth).map((purchase) => purchase.itemId),
      ...(own?.items ?? []),
      own?.roleItem
    ],
    '本人'
  )
  tag(
    [
      ...(report.opponentBuild?.purchases.filter(worth).map((purchase) => purchase.itemId) ?? []),
      ...(opponent?.items ?? [])
    ],
    '对位'
  )
  // 其余敌人只写局末的成装：看对面有什么需要针对的。
  for (const player of sortedPlayers(input)) {
    if (player.teamId === meta.teamId || player.participantId === meta.opponentId) continue
    tag(
      player.items.filter(
        (id) => (catalogue.item(id)?.price ?? 0) >= REVIEW_COACH_ENEMY_ITEM_MIN_PRICE
      ),
      `敌方${POSITION[player.position]}`
    )
  }
  const listed = tags.size
  if (statistics) {
    const tables = [statistics.versus, statistics.general].filter(
      (table): table is ReviewLoadoutTable => !!table
    )
    // 成装在前，出门装在最后：篇幅有限时先留下最值得比较的。
    const candidates = (['core', 'late', 'boots', 'starting'] as const).flatMap((key) =>
      tables.flatMap((table) => table[key].flatMap((option) => option.ids))
    )
    for (const id of candidates) {
      if (tags.has(id)) continue
      if (tags.size - listed >= REVIEW_COACH_MAX_CANDIDATE_ITEMS) break
      tag([id], '统计里常见')
    }
  }

  return [...tags.entries()].flatMap(([id, labels]) => {
    const item = catalogue.item(id)
    if (!item) return []
    const body = [item.stats.join('、'), item.effects].filter(Boolean).join('。')
    return [
      `- ${names.item(id)}〔${[...labels].join('、')}〕${item.price ? `（${item.price} 金）` : ''}${
        body ? `：${body}` : ''
      }`
    ]
  })
}

// ── 属性快照 ───────────────────────────────────────────────────────────

export function statSnapshotLines(input: ReviewLoadoutInput): string[] {
  const { match, report } = input
  const { meta } = match
  const times = new Set<number>()
  for (const checkpoint of report.checkpoints)
    if (checkpoint.timestamp !== null) times.add(checkpoint.timestamp)
  const last = match.frames.at(-1)
  if (last && last.timestamp > 0) times.add(last.timestamp)

  const enemies = [...match.participants]
    .filter(
      (participant) =>
        participant.teamId !== meta.teamId && participant.participantId !== meta.opponentId
    )
    .sort((a, b) => roleOrder(a.position) - roleOrder(b.position))
  const count = (value: number | null | undefined) =>
    value == null ? '?' : String(Math.round(value))
  const full = (frame: ReviewParticipantFrame | undefined) =>
    `攻击 ${count(frame?.attackDamage)} 法强 ${count(frame?.abilityPower)} 护甲 ${count(frame?.armor)} 魔抗 ${count(
      frame?.magicResist
    )} 生命上限 ${count(frame?.healthMax)}`
  const known = (frame: ReviewParticipantFrame | undefined) =>
    frame?.armor != null || frame?.magicResist != null || frame?.healthMax != null

  const rows = [...times]
    .sort((a, b) => a - b)
    .flatMap((timestamp) => {
      const frame = match.frames.find((entry) => entry.timestamp === timestamp)
      const of = (id: number | null) =>
        id === null ? undefined : frame?.participants.find((entry) => entry.participantId === id)
      if (!frame || !known(of(meta.participantId))) return []
      return [
        [
          clock(timestamp),
          `本人 ${full(of(meta.participantId))}`,
          ...(meta.opponentId === null ? [] : [`对位 ${full(of(meta.opponentId))}`]),
          ...(enemies.length
            ? [
                enemies
                  .map((enemy) => {
                    const entry = of(enemy.participantId)
                    return `${ROLE_TAG[enemy.position]} ${count(entry?.armor)}/${count(entry?.magicResist)}/${count(
                      entry?.healthMax
                    )}`
                  })
                  .join('、')
              ]
            : [])
        ].join('｜')
      ]
    })
  if (!rows.length) return []
  return [
    `每行依次是：时间｜本人的攻击力、法术强度、护甲、魔抗、生命上限${
      meta.opponentId === null ? '' : '｜对位的同样五项'
    }${enemies.length ? '｜敌方其余几人的 护甲/魔抗/生命上限（上 = 上单、野 = 打野、中 = 中单、下 = 下路、辅 = 辅助）' : ''}。`,
    ...rows
  ]
}

// ── 同段位统计 ─────────────────────────────────────────────────────────

// 地区和段位的叫法与英雄数据页的筛选项一致（opgg.yaml）；不认识的原样写出。
const REGION: Record<string, string> = {
  global: '全球',
  na: '北美',
  euw: '欧洲西',
  kr: '韩国',
  br: '巴西',
  eune: '欧洲东北',
  jp: '日本',
  lan: '拉丁美洲北',
  las: '拉丁美洲南',
  oce: '大洋洲',
  tr: '土耳其',
  ru: '俄罗斯',
  sg: '新加坡',
  id: '印尼',
  ph: '菲律宾',
  th: '泰国',
  vn: '越南',
  tw: '台湾',
  me: '中东'
}
const TIER: Record<string, string> = {
  all: '全部段位',
  bronze_plat: '青铜到铂金',
  ibsg: '黄金及以下',
  gold_plus: '黄金及以上',
  platinum_plus: '铂金及以上',
  emerald_plus: '翡翠及以上',
  diamond_plus: '钻石及以上',
  master: '大师',
  master_plus: '大师及以上',
  grandmaster: '宗师',
  challenger: '王者'
}

/** Where the statistics are from, in words: region, rank range and patch. */
export function describeReviewStatisticsScope(statistics: ReviewLoadoutStatistics) {
  return {
    region: REGION[statistics.region] ?? statistics.region,
    tier: TIER[statistics.tier] ?? statistics.tier,
    patch: statistics.patch ?? '未知'
  }
}

const usage = (option: { games: number; wins: number; pickRate: number | null }) =>
  `${option.pickRate === null ? '' : `使用率 ${percentFine(option.pickRate)}，`}胜率 ${percentFine(
    option.wins / option.games
  )}（${option.games} 局）`

const sameSet = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join()

export function statisticsLines(
  input: ReviewLoadoutInput,
  statistics: ReviewLoadoutStatistics
): string[] {
  const { match, report, names } = input
  const { meta } = match
  const own = report.players.find((player) => player.participantId === meta.participantId)
  const runes = own?.runes ?? null
  const champion = `${names.champion(meta.championId)} ${POSITION[meta.position]}`
  const opponentName =
    meta.opponentChampionId === null ? null : names.champion(meta.opponentChampionId)
  const ownPrimary = runes?.perks.slice(0, runes.primaryCount) ?? []
  const ownSecondary = runes?.perks.slice(runes?.primaryCount ?? 0) ?? []
  const samePage = (page: ReviewRunePageOption) =>
    !!runes && sameSet(page.primary, ownPrimary) && sameSet(page.secondary, ownSecondary)

  const pageRunes = (page: ReviewRunePageOption) =>
    `【${treeName(input, page.primaryStyle)}】${list(page.primary, names.perk)}｜【${treeName(
      input,
      page.secondaryStyle
    )}】${list(page.secondary, names.perk)}${
      page.shards.length ? `｜碎片 ${list(page.shards, names.perk)}` : ''
    }`
  const pageText = (page: ReviewRunePageOption, order: number) => {
    // 这一行的数字是「同一个基石、同一个副系的全部带法」合计的，符文只是其中最常见的一页：两样分开写。
    // 同一个主系里有几个基石时会有几行主系副系都相同，所以写的是基石，不是主系。
    if (page.groupTotal) {
      const mine =
        !runes || page.primary[0] !== ownPrimary[0]
          ? ''
          : page.secondaryStyle === runes.subStyle
            ? ' ← 本人这局的基石和副系与此相同'
            : ' ← 基石与本人这局相同，副系不同'
      return `符文组合 ${order}：基石 ${names.perk(page.primary[0])}、副系【${treeName(
        input,
        page.secondaryStyle
      )}】的全部带法合计——${usage(page)}${mine}。其中最常见的一页：${pageRunes(page)}`
    }
    const relation = !runes
      ? ''
      : samePage(page)
        ? ' ← 六颗符文与本人这局相同'
        : page.primary[0] === ownPrimary[0]
          ? ' ← 基石与本人这局相同'
          : ''
    return `符文页 ${order}：${pageRunes(page)}——${usage(page)}${relation}`
  }
  const optionText = (
    option: ReviewLoadoutOption,
    mine: readonly number[] | null,
    joiner: string
  ) =>
    `${list(option.ids, joiner === '+' ? names.spell : names.item, joiner)}——${usage(option)}${
      mine && sameSet(option.ids, mine) ? ' ← 本人这局' : ''
    }`
  const keystones = (pages: ReviewRunePageOption[]) => {
    const groups = new Map<number, { games: number; wins: number }>()
    for (const page of pages) {
      const group = groups.get(page.primary[0]) ?? { games: 0, wins: 0 }
      group.games += page.games
      group.wins += page.wins
      groups.set(page.primary[0], group)
    }
    return [...groups.entries()]
      .sort((a, b) => b[1].games - a[1].games)
      .map(
        ([id, group]) =>
          `${names.perk(id)} 胜率 ${percentFine(group.wins / group.games)}（${group.games} 局）`
      )
      .join('；')
  }
  const table = (data: ReviewLoadoutTable) => {
    const firstVisit = report.build.visits[0]
    // 出门装里的饰品不算：统计的出门装不含饰品。
    const starting =
      firstVisit && firstVisit.timestamp < REVIEW_FIRST_SHOP_AFTER_MS
        ? report.build.purchases
            .filter(
              (purchase) =>
                purchase.timestamp < REVIEW_FIRST_SHOP_AFTER_MS && purchase.kind !== 'trinket'
            )
            .map((purchase) => purchase.itemId)
        : null
    const core = report.build.coreItems.slice(0, 3).map((item) => item.itemId)
    const exact = data.runePages.filter((page) => !page.groupTotal)
    // 按「基石加副系」合计的行，一行只有一个基石：同一个基石占了不止一行时才值得再加总一遍，
    // 否则就是把下面的行重抄一遍。这种行也谈不上和本人的六颗相同不相同。
    const grouped = data.runePages.filter((page) => page.groupTotal)
    const repeated =
      new Set(grouped.map((page) => page.primary[0])).size < grouped.length ? grouped : []
    return [
      exact.length ? `按基石合计（只合计下面列出的这几套符文页）：${keystones(exact)}。` : null,
      repeated.length ? `按基石合计（只合计下面列出的这几行）：${keystones(repeated)}。` : null,
      ...data.runePages.map((page, index) => pageText(page, index + 1)),
      exact.length && runes && !exact.some(samePage)
        ? '上面列出的符文页里，没有哪一套和本人这局的六颗完全相同。'
        : null,
      data.spells.length
        ? `召唤师技能：${data.spells
            .map((option) => optionText(option, own?.summonerSpells ?? null, '+'))
            .join('；')}。`
        : null,
      data.starting.length
        ? `出门装：${data.starting.map((option) => optionText(option, starting, '、')).join('；')}。`
        : null,
      data.boots.length
        ? `鞋：${data.boots
            .map((option) =>
              optionText(option, report.build.boots ? [report.build.boots.itemId] : null, '、')
            )
            .join('；')}。`
        : null,
      data.core.length
        ? `前三件成装：${data.core
            .map((option) => optionText(option, core.length === 3 ? core : null, ' → '))
            .join('；')}。`
        : null,
      // 来源的这一项是「出过这件装备的对局」的汇总，不分它是第几件出的。
      data.late.length
        ? `单件装备（出过它的对局，不分第几件出）：${data.late
            .map((option) => optionText(option, null, '、'))
            .join('；')}。`
        : null
    ].filter((line): line is string => !!line)
  }

  const overall = statistics.champion
  const scope = describeReviewStatisticsScope(statistics)
  return [
    `口径：${scope.region}、${scope.tier}的排位，版本 ${scope.patch}${
      statistics.samePatch
        ? '（就是这一局的版本）'
        : `（这一局是 ${meta.patch}，来源已经没有那个版本的统计，用的是它现有的最新版本）`
    }。`,
    `读法：使用率和局数是来源给的，符文、技能、出装各按有记录的对局算，分母不完全相同，不要拿不同类别的局数互相除。每一类只列最常见的几项，不到 ${REVIEW_STATISTICS_MIN_GAMES} 局的带法不列，没列出来的不等于没人带。「前三件成装」只统计出满三件的对局，「单件装备」里越靠后才出的装备，胜率越偏高：能出到那一步的多半是打得久、打得顺的局。所以这两类的胜率不要和英雄的总体胜率比，只在同一类里互相比。`,
    // 来源只给英雄常打的那几个位置列总体数字；打的是别的位置时，下面各表仍然是这个位置的。
    `${
      overall.games === null && overall.winRate === null
        ? `${champion}：来源没有给这个位置的总体胜率和样本数（它只给这个英雄常打的位置列），下面各表是这个位置的，样本比常打的位置小得多。`
        : `${champion}：胜率 ${percentFine(overall.winRate)}，登场率 ${percentFine(overall.pickRate)}，样本 ${whole(
            overall.games
          )} 局。`
    }${
      opponentName
        ? statistics.matchup
          ? `对 ${opponentName}：胜率 ${percentFine(statistics.matchup.wins / statistics.matchup.games)}（${statistics.matchup.games} 局）。`
          : `对 ${opponentName} 的对局来源没有单独列出。`
        : ''
    }`,
    ...table(statistics.general),
    ...(statistics.versus && opponentName
      ? [
          `只看对 ${opponentName} 的对局（样本小得多，胜率的波动很大${
            statistics.versus.runePages.some((page) => page.groupTotal)
              ? '。这一份里符文按「基石加副系」合计：一行是同一个基石、同一个副系的全部带法，不是某一页'
              : ''
          }）：`,
          ...table(statistics.versus)
        ]
      : opponentName
        ? [`只看对 ${opponentName} 的对局：来源的样本不够，没有单独的统计。`]
        : [])
  ]
}

// ── 本人以往的带法 ─────────────────────────────────────────────────────

export function historyLines(input: ReviewLoadoutInput, history: ReviewLoadoutHistory): string[] {
  const { match, names } = input
  const { meta } = match
  const record = (name: (id: number) => string, joiner: string) => (entry: ReviewLoadoutRecord) =>
    `${entry.ids.map(name).join(joiner)} ${entry.games} 局 ${entry.wins} 胜`
  const group = (data: ReviewLoadoutHistoryGroup) =>
    [
      data.keystones.length
        ? `基石：${data.keystones.map(record(names.perk, '')).join('；')}。`
        : null,
      data.pages.length
        ? `整套符文（只算存档时记下了整页符文的对局）：${data.pages
            .map(
              (entry) =>
                `〔${list(entry.ids.slice(0, REVIEW_PRIMARY_RUNES), names.perk)}｜${list(
                  entry.ids.slice(REVIEW_PRIMARY_RUNES),
                  names.perk
                )}〕${entry.games} 局 ${entry.wins} 胜`
            )
            .join('；')}。`
        : null,
      data.spells.length
        ? `召唤师技能：${data.spells.map(record(names.spell, '+')).join('；')}。`
        : null,
      data.firstItems.length
        ? `第一件成装：${data.firstItems.map(record(names.item, '')).join('；')}。`
        : null,
      data.corePaths.length
        ? `前三件成装（只算出满三件的对局）：${data.corePaths.map(record(names.item, ' → ')).join('；')}。`
        : null
    ].filter((line): line is string => !!line)
  return [
    `本机档案里本人用 ${names.champion(meta.championId)} 打 ${POSITION[meta.position]} 的另外 ${history.champion.games} 局（${history.champion.wins} 胜），不含这一局：`,
    ...group(history.champion),
    ...(history.matchup && meta.opponentChampionId !== null
      ? [
          `其中对 ${names.champion(meta.opponentChampionId)} 的 ${history.matchup.games} 局（${history.matchup.wins} 胜）：`,
          ...group(history.matchup)
        ]
      : [])
  ]
}
