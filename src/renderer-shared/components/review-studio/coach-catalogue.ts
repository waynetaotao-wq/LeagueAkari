import type {
  ChampDetails,
  ChampionSimple,
  Item,
  Perk,
  Style,
  SummonerSpell
} from '@shared/types/league-client/game-data'

import { plainGameText, readItemText } from './game-text'

// [lolps] 教练资料包用到的「说明书」：符文、装备、召唤师技能在客户端里是怎么写的，
// 符文树怎么分行。全部取自客户端自己的游戏数据，所以总是当前版本、当前语言的；
// 模型据此判断「换哪颗符文」，就不会推荐已经改掉或删掉的东西。

export interface ReviewCoachRune {
  name: string
  /** One-line summary and the full text with its numbers, both as plain text. */
  short: string
  long: string
  /** The client's labels for the numbers a match records for this rune. */
  statLabels: readonly string[]
}

export interface ReviewCoachRuneTree {
  id: number
  name: string
  /** What the tree is about, in the client's words. */
  theme: string
  keystones: number[]
  /** The rows of minor runes, top to bottom; one rune per row can be taken. */
  rows: number[][]
  /** The rows of stat shards, top to bottom. */
  shardRows: number[][]
}

export interface ReviewCoachItem {
  name: string
  /** Total price; null for an item that cannot be bought. */
  price: number | null
  stats: string[]
  effects: string
  /** The items this one is made from, as the client lists them. */
  from: number[]
}

export interface ReviewCoachSpell {
  name: string
  /** Base cooldown in seconds as the client lists it. */
  cooldown: number | null
  description: string
}

export interface ReviewCoachAbility {
  /** 被动, Q, W, E or R. */
  key: string
  name: string
  description: string
  /** Base cooldown in seconds at each rank; one value when it never changes, none for a passive. */
  cooldowns: number[]
}

/** What the client says about a champion's kit. */
export interface ReviewCoachChampion {
  /** 近战 or 远程; null when the client does not say. */
  attack: string | null
  /** 物理, 魔法 or 混合: the kind of damage the client lists for the champion. */
  damage: string | null
  /** The client's own ratings from 1 to 3, e.g. 伤害 3、坦度 1. */
  ratings: Array<{ label: string; value: number }>
  abilities: ReviewCoachAbility[]
}

export interface ReviewCoachCatalogue {
  rune(id: number): ReviewCoachRune | null
  /** Every rune tree of the client, in id order. */
  runeTrees: ReviewCoachRuneTree[]
  item(id: number): ReviewCoachItem | null
  spell(id: number): ReviewCoachSpell | null
  /** Summoner spells that can be taken on Summoner's Rift, in id order. */
  riftSpells: number[]
  /** The client's class tags of a champion, e.g. 刺客、坦克. */
  championRoles(id: number): string[]
  /** A champion's abilities; null until its details have been read from the client. */
  champion(id: number): ReviewCoachChampion | null
}

export interface ReviewCoachGameData {
  perks: Readonly<Record<number, Perk | undefined>>
  styles: Readonly<Record<number, Style | undefined>>
  items: Readonly<Record<number, Item | undefined>>
  spells: Readonly<Record<number, SummonerSpell | undefined>>
  champions: Readonly<Record<number, ChampionSimple | undefined>>
  /** Full champion entries, read one by one when a game needs them. */
  championDetails?: Readonly<Record<number, ChampDetails | undefined>>
}

const ATTACK_TYPE: Record<string, string> = { melee: '近战', ranged: '远程' }
const DAMAGE_TYPE: Record<string, string> = { kPhysical: '物理', kMagic: '魔法', kMixed: '混合' }
const RATINGS = [
  ['damage', '伤害'],
  ['durability', '坦度'],
  ['crowdControl', '控制'],
  ['mobility', '机动'],
  ['utility', '功能']
] as const

const CHAMPION_ROLE: Record<string, string> = {
  assassin: '刺客',
  fighter: '战士',
  mage: '法师',
  marksman: '射手',
  support: '辅助型',
  tank: '坦克'
}

const SLOT_KEYSTONE = 'kKeyStone'
const SLOT_SHARD = 'kStatMod'
/** Summoner's Rift in the spells' list of game modes. */
const RIFT_GAME_MODE = 'CLASSIC'

const ids = (value: unknown) =>
  (Array.isArray(value) ? value : []).filter(
    (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0
  )

/**
 * Wraps the client's game data. Lookups are done on demand, so the catalogue follows the data
 * as it loads; an id the client does not know gives null.
 */
export function buildReviewCoachCatalogue(data: ReviewCoachGameData): ReviewCoachCatalogue {
  return {
    rune(id) {
      const perk = data.perks[id]
      if (!perk?.name) return null
      const long = plainGameText(perk.longDesc)
      const short = plainGameText(perk.shortDesc)
      return {
        name: perk.name,
        short: short || long,
        long: long || short,
        statLabels: Array.isArray(perk.endOfGameStatDescs) ? perk.endOfGameStatDescs : []
      }
    },
    get runeTrees() {
      return Object.values(data.styles)
        .filter((style): style is Style => !!style?.name && Array.isArray(style.slots))
        .sort((a, b) => a.id - b.id)
        .map((style) => {
          const slots = style.slots.filter((slot) => slot && Array.isArray(slot.perks))
          return {
            id: style.id,
            name: style.name,
            theme: plainGameText(style.tooltip),
            keystones: slots
              .filter((slot) => slot.type === SLOT_KEYSTONE)
              .flatMap((s) => ids(s.perks)),
            rows: slots
              .filter((slot) => slot.type !== SLOT_KEYSTONE && slot.type !== SLOT_SHARD)
              .map((slot) => ids(slot.perks)),
            shardRows: slots.filter((slot) => slot.type === SLOT_SHARD).map((s) => ids(s.perks))
          }
        })
        .filter((tree) => tree.keystones.length && tree.rows.length)
    },
    item(id) {
      const item = data.items[id]
      if (!item?.name) return null
      return {
        name: item.name,
        price: Number.isFinite(item.priceTotal) && item.priceTotal > 0 ? item.priceTotal : null,
        ...readItemText(item.description),
        from: ids(item.from)
      }
    },
    spell(id) {
      const spell = data.spells[id]
      if (!spell?.name) return null
      return {
        name: spell.name,
        cooldown: Number.isFinite(spell.cooldown) && spell.cooldown > 0 ? spell.cooldown : null,
        description: plainGameText(spell.description)
      }
    },
    get riftSpells() {
      return Object.values(data.spells)
        .filter(
          (spell): spell is SummonerSpell =>
            !!spell?.name &&
            Array.isArray(spell.gameModes) &&
            spell.gameModes.includes(RIFT_GAME_MODE)
        )
        .map((spell) => spell.id)
        .sort((a, b) => a - b)
    },
    championRoles(id) {
      const roles = data.champions[id]?.roles
      return (Array.isArray(roles) ? roles : []).flatMap((role) =>
        typeof role === 'string' && CHAMPION_ROLE[role] ? [CHAMPION_ROLE[role]] : []
      )
    },
    champion(id) {
      const details = data.championDetails?.[id]
      if (!details || !Array.isArray(details.spells)) return null
      const tactical = details.tacticalInfo as
        { damageType?: unknown; attackType?: unknown } | undefined
      const playstyle = details.playstyleInfo as unknown as Record<string, unknown> | undefined
      const abilities: ReviewCoachAbility[] = []
      if (details.passive?.name)
        abilities.push({
          key: '被动',
          name: details.passive.name,
          description: plainGameText(details.passive.description),
          cooldowns: []
        })
      for (const spell of details.spells) {
        if (!spell?.name || typeof spell.spellKey !== 'string') continue
        // 冷却按技能等级给：最后一格是多出来的重复值，只取到技能的最高等级。
        const ranks = (Array.isArray(spell.cooldownCoefficients) ? spell.cooldownCoefficients : [])
          .slice(0, Number.isInteger(spell.maxLevel) && spell.maxLevel > 0 ? spell.maxLevel : 0)
          .filter((seconds) => typeof seconds === 'number' && Number.isFinite(seconds))
        abilities.push({
          key: spell.spellKey.toUpperCase(),
          name: spell.name,
          description: plainGameText(spell.description),
          cooldowns: new Set(ranks).size === 1 ? [ranks[0]] : ranks
        })
      }
      if (!abilities.length) return null
      return {
        attack: ATTACK_TYPE[String(tactical?.attackType)] ?? null,
        damage: DAMAGE_TYPE[String(tactical?.damageType)] ?? null,
        ratings: RATINGS.flatMap(([key, label]) => {
          const value = playstyle?.[key]
          return typeof value === 'number' && Number.isFinite(value) ? [{ label, value }] : []
        }),
        abilities
      }
    }
  }
}
