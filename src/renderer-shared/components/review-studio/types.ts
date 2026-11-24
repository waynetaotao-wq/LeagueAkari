// [lolps] 复盘仅展示服务端证据；缺失数值必须保持 null。
export type ReviewPosition = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | 'UNKNOWN'

export interface ReviewParticipant {
  participantId: number
  puuid: string
  championId: number
  championName: string
  name: string
  teamId: 100 | 200
  position: ReviewPosition
  win: boolean
}

export interface ReviewPoint {
  x: number
  y: number
}

export interface ReviewParticipantFrame {
  participantId: number
  gold: number | null
  cs: number | null
  position: ReviewPoint | null
  level: number | null
  alive: boolean | null
  /** Experience points; absent in frames built before the full report existed. */
  xp?: number | null
  /** Cumulative damage dealt to champions up to this snapshot. */
  damage?: number | null
  /** Cumulative damage taken up to this snapshot. */
  damageTaken?: number | null
  /** Gold in the purse at this snapshot. */
  unspentGold?: number | null
  /** Health at this snapshot and its maximum. */
  health?: number | null
  healthMax?: number | null
  /** Attack damage, ability power, armor and magic resistance at this snapshot. */
  attackDamage?: number | null
  abilityPower?: number | null
  armor?: number | null
  magicResist?: number | null
}

export interface ReviewFrame {
  timestamp: number
  participants: ReviewParticipantFrame[]
  personalGoldDiff: number | null
  personalCsDiff: number | null
  teamGoldDiff: number | null
}

export interface ReviewEvent {
  id: string
  timestamp: number
  type: 'kill' | 'building' | 'monster'
  killerId: number | null
  victimId: number | null
  assistingParticipantIds: number[]
  /** Team receiving the kill/objective; never the destroyed building's team. */
  teamId: 100 | 200 | null
  /**
   * Monsters only: the record credits no player and names the neutral team, so nobody took it
   * (实测 16.23：两局的峡谷先锋都是 19:45 这样记的，那是它到时间离场的时刻). Absent otherwise.
   */
  unclaimed?: boolean
  position: ReviewPoint | null
  shutdownBounty: number | null
  buildingType: string | null
  laneType: string | null
  monsterType: string | null
  monsterSubType: string | null
}

export interface ReviewSnapshot {
  minute: 10 | 15 | 20
  /** Actual sampled timestamp, at most 10 seconds from the requested minute. */
  timestamp: number | null
  personalGoldDiff: number | null
  personalCsDiff: number | null
  teamGoldDiff: number | null
}

export interface ReviewMoment {
  id: string
  kind: 'gold-swing' | 'gold-gain' | 'shutdown' | 'repeated-deaths' | 'death-objective'
  title: string
  description: string
  start: number
  end: number
  eventIds: string[]
  scope: 'personal' | 'team' | null
  before: number | null
  after: number | null
}

export interface ReviewQuality {
  expectedFrames: number
  missingFrames: number
  timelineCoverage: number
  validGoldSnapshots: number
  validCsSnapshots: number
  validTeamSnapshots: number
  eventCoverage: 'complete' | 'partial'
  warnings: string[]
}

/** An enemy champion credited with a kill or an assist on the reviewed player. */
export interface ReviewDeathSource {
  championId: number
  role: ReviewPosition
}

/** One recorded death of the reviewed player. */
export interface ReviewDeath {
  timestamp: number
  /** Coordinates recorded with the kill event itself; never taken from a minute snapshot. */
  point: ReviewPoint | null
  /** Null when a turret, minion or monster dealt the killing blow. */
  killer: ReviewDeathSource | null
  assists: ReviewDeathSource[]
  shutdownBounty: number | null
}

/**
 * Early-game measurements used to compare wins with losses. Each field stays null when the
 * game is too short, the role does not apply or the timeline cannot prove the value.
 */
export interface ReviewEarlyFacts {
  /** Own creep score in the 10-minute snapshot. */
  cs10: number | null
  deathsBefore10: number | null
  /** Deaths before 14:00 to exactly one enemy champion. */
  soloDeathsBefore14: number | null
  /** Deaths before 14:00 credited to the enemy jungler as killer or assistant. */
  jungleDeathsBefore14: number | null
  /** Own kills plus assists before 14:00. */
  takedownsBefore14: number | null
  wardsBefore10: number | null
  controlWardsBefore15: number | null
  /** First purchase after 2:00, i.e. the first time back at the shop. */
  firstShopAt: number | null
  firstCoreItemAt: number | null
  firstCoreItemId: number | null
  /** Plates of the own lane's enemy turrets destroyed before 14:00. */
  platesTaken: number | null
  /** Plates of the own lane's allied turrets destroyed before 14:00. */
  platesLost: number | null
  /** Mid lane only: separate visits to a side-lane corridor before 14:00, from minute snapshots. */
  roamsBefore14: number | null
}

/** What an item is according to the client's item catalogue. */
export type ReviewItemKind =
  'core' | 'boots' | 'component' | 'starter' | 'consumable' | 'trinket' | 'other'

export interface ReviewRunes {
  primaryStyle: number | null
  subStyle: number | null
  /** Keystone first, then the remaining selections in page order. */
  perks: number[]
  /** How many of `perks` belong to the primary tree; the rest are from the secondary tree. */
  primaryCount: number
  /**
   * The three end-of-game numbers the server records for each rune of `perks`, in the same
   * order. What they mean is said by the rune's own stat labels in the client's game data.
   */
  stats: number[][]
  /** Offense, flex and defense shards. */
  shards: number[]
}

/** Ability and summoner-spell cast counts from the match summary. */
export interface ReviewCasts {
  q: number | null
  w: number | null
  e: number | null
  r: number | null
  summoner1: number | null
  summoner2: number | null
}

/**
 * Final stat line of one participant, copied from the match summary. A value the summary does
 * not carry stays null; shares are fractions of the participant's own team.
 */
export interface ReviewPlayerLine {
  participantId: number
  teamId: 100 | 200
  championId: number
  position: ReviewPosition
  kills: number | null
  deaths: number | null
  assists: number | null
  level: number | null
  /** Lane minions plus jungle monsters. */
  cs: number | null
  jungleCs: number | null
  gold: number | null
  goldSpent: number | null
  /** Damage dealt to champions. */
  damage: number | null
  physicalDamage: number | null
  magicDamage: number | null
  trueDamage: number | null
  damageTaken: number | null
  /** Damage taken by type; tells which kind of defence would have mattered. */
  physicalDamageTaken: number | null
  magicDamageTaken: number | null
  trueDamageTaken: number | null
  damageMitigated: number | null
  objectiveDamage: number | null
  turretDamage: number | null
  /**
   * Damage to epic monsters. 实测 16.23（280 个视角）：官方的「对地图目标」等于它加上对防御塔的，
   * 相差不超过 1。Absent in lines built before this was read.
   */
  epicMonsterDamage?: number | null
  healing: number | null
  allyHealing: number | null
  allyShielding: number | null
  /** Seconds of crowd control applied to enemies. */
  ccSeconds: number | null
  visionScore: number | null
  wardsPlaced: number | null
  wardsKilled: number | null
  controlWardsBought: number | null
  secondsDead: number | null
  longestLife: number | null
  largestKillingSpree: number | null
  largestMultiKill: number | null
  firstBloodKill: boolean | null
  firstBloodAssist: boolean | null
  firstTowerKill: boolean | null
  firstTowerAssist: boolean | null
  turretTakedowns: number | null
  inhibitorTakedowns: number | null
  dragonKills: number | null
  baronKills: number | null
  objectivesStolen: number | null
  /** Inventory slots at game end, empty slots removed. */
  items: number[]
  trinket: number | null
  /** The extra role-bound item slot of recent seasons. */
  roleItem: number | null
  summonerSpells: number[]
  casts: ReviewCasts
  runes: ReviewRunes | null
  killParticipation: number | null
  damageShare: number | null
  damageTakenShare: number | null
  goldShare: number | null
  /** Selected counters from the server's own challenge tracking; null when the summary has none. */
  challenges: Record<string, number> | null
  /** The server flagged this player as away from the keyboard; null when the summary does not say. */
  afk: boolean | null
  /** How often each kind of ping was used; kinds the summary does not carry are left out. */
  pings: Record<string, number> | null
}

/** How the position played relates to what the player queued for. */
export interface ReviewRoleAssignment {
  /**
   * `primary` / `secondary`: the position played was the first / second choice in the queue;
   * `fill`: the player queued as fill; `autofill`: it was neither choice.
   */
  choice: 'primary' | 'secondary' | 'fill' | 'autofill'
  /** What was chosen in the queue, first choice first; a slot left open is missing. */
  preferences: Array<Exclude<ReviewPosition, 'UNKNOWN'> | 'FILL'>
  /** The position matchmaking handed out, when it is not the one played. */
  assigned: ReviewPosition | null
}

export interface ReviewTeamLine {
  teamId: 100 | 200
  win: boolean | null
  /**
   * Sum of the five players' kills, the denominator of kill participation. The summary's own
   * team counter can be larger because it also counts enemies executed by turrets or minions.
   */
  kills: number | null
  gold: number | null
  damage: number | null
  towers: number | null
  inhibitors: number | null
  dragons: number | null
  barons: number | null
  heralds: number | null
  grubs: number | null
  atakhans: number | null
  firstBlood: boolean | null
  firstTower: boolean | null
  firstDragon: boolean | null
  firstBaron: boolean | null
  bans: number[]
  /** Dragon sub-types in the order this team took them, elder dragons included. */
  dragonTypes: string[]
  soul: string | null
}

export interface ReviewPurchase {
  timestamp: number
  itemId: number
  /** Null when the item catalogue is unavailable or does not know the item. */
  kind: ReviewItemKind | null
}

/** Purchases made close together, i.e. one stop at the shop. */
export interface ReviewShopVisit {
  timestamp: number
  /** The stop follows an own death instead of a recall. */
  afterDeath: boolean
  /** Items bought during the stop and kept; empty when everything was undone or only sold. */
  itemIds: number[]
  /** Items sold during the stop and not taken back; absent when there are none. */
  soldIds?: number[]
}

export interface ReviewBuild {
  /** Purchases still held after undo events, in order. */
  purchases: ReviewPurchase[]
  sales: Array<{ timestamp: number; itemId: number }>
  /** Completed items in purchase order; empty when the catalogue cannot classify items. */
  coreItems: Array<{ timestamp: number; itemId: number }>
  /** First upgraded pair of boots. */
  boots: { timestamp: number; itemId: number } | null
  /**
   * For each item that left the inventory (used up, combined into something, or turned into
   * another item): when it did so for the last time and how often. Absent when not read.
   */
  destroyed?: Record<number, { timestamp: number; count: number }>
  visits: ReviewShopVisit[]
  /** Ability level-ups in order: 1 = Q, 2 = W, 3 = E, 4 = R. */
  skills: Array<{ timestamp: number; slot: 1 | 2 | 3 | 4 }>
  /**
   * Basic abilities in the order they are being maxed. Only the part the level-ups actually
   * settle is listed, so a short game may give one entry or null.
   */
  skillPriority: Array<1 | 2 | 3> | null
}

export interface ReviewLevelTiming {
  level: number
  /** Time of the recorded level-up; null when the timeline has none. */
  own: number | null
  opponent: number | null
}

export interface ReviewCheckpointSide {
  gold: number | null
  cs: number | null
  xp: number | null
  level: number | null
  damage: number | null
}

/** Own numbers against the lane opponent at a fixed minute; diffs are own minus opponent. */
export interface ReviewCheckpoint {
  minute: number
  /** Actual sampled time, at most 10 seconds from the minute; null when no snapshot is close. */
  timestamp: number | null
  own: ReviewCheckpointSide | null
  opponent: ReviewCheckpointSide | null
  goldDiff: number | null
  csDiff: number | null
  xpDiff: number | null
  levelDiff: number | null
  teamGoldDiff: number | null
}

/** A kill or an assist of the reviewed player. */
export interface ReviewTakedown {
  timestamp: number
  point: ReviewPoint | null
  victim: ReviewDeathSource
  /** True for the killing blow, false for an assist. */
  kill: boolean
  /** Other allies credited on the same kill. */
  allies: number
  /** Gold the kill itself paid and the extra shutdown gold, as recorded for the killer. */
  bounty: number | null
  shutdownBounty: number | null
  firstBlood: boolean
  /** What the reviewed player did to the victim; null when the kill record lists none of it. */
  damage: ReviewOwnDamage | null
}

/** The reviewed player's damage on one victim, from the damage list of the kill record. */
export interface ReviewOwnDamage {
  total: number
  slots: ReviewDamageSlots
  /** The part of `slots.summoner` that is Ignite. */
  ignite: number
  /** Everything the victim took according to the same list, this player's part included. */
  victimTotal: number
}

export interface ReviewDamageSlots {
  basic: number
  passive: number
  q: number
  w: number
  e: number
  r: number
  /** The two summoner spells, e.g. Ignite or Smite. */
  summoner: number
  /** Item actives, runes and anything else the record does not tie to an ability. */
  other: number
}

export interface ReviewDamageSource {
  kind: 'champion' | 'turret' | 'minion' | 'monster' | 'other'
  /** Set for champions only. */
  championId: number | null
  role: ReviewPosition | null
  total: number
  physical: number
  magic: number
  trueDamage: number
  slots: ReviewDamageSlots
}

/** Extra facts about one own death; same order as `ReviewMatch.deaths`. */
export interface ReviewDeathDetail {
  timestamp: number
  /** Damage listed in the kill record, grouped by source, largest first. */
  sources: ReviewDamageSource[]
  damageTaken: number | null
  /** Damage the victim dealt according to the same record. */
  damageDealt: number | null
  /**
   * The same two totals from the record's wider "teamfight" lists, which are never smaller;
   * null when the record has no such list.
   */
  fightDamageTaken: number | null
  fightDamageDealt: number | null
  bounty: number | null
  /**
   * Own and killer levels right before the death: the last recorded level-up before it, or the
   * last snapshot when the timeline has no level-up to go by.
   */
  level: number | null
  killerLevel: number | null
  /** Index into `ReviewReport.fights`; null for a death outside any fight. */
  fight: number | null
  /** Enemy objectives within 90 seconds after this death: indexes into `ReviewReport.objectives`. */
  objectivesAfter: number[]
}

export type ReviewObjectiveKind =
  'dragon' | 'elder' | 'herald' | 'grubs' | 'baron' | 'atakhan' | 'tower' | 'inhibitor' | 'other'

export interface ReviewObjective {
  timestamp: number
  kind: ReviewObjectiveKind
  /** Dragon element, turret tier or the raw monster type, as recorded. */
  detail: string | null
  lane: string | null
  /** True when the reviewed player's team took it; null when the record does not say. */
  own: boolean | null
  /** The reviewed player is the killer or an assistant. */
  credited: boolean
  /**
   * The enemy took it, yet the record lists the reviewed player among those who fought it.
   * Absent when not.
   */
  contested?: boolean
  /** Nobody took it: the record credits the neutral team, as when a monster leaves the map. */
  unclaimed?: boolean
  /** Milliseconds since the reviewed player's last death, when that was at most 90 s earlier. */
  sinceDeath: number | null
  /**
   * Distance between the objective and own position in the nearest snapshot, in map units;
   * null when there is no such snapshot or the player is dead in it.
   */
  distance: number | null
  /** How far that snapshot is from the event in milliseconds; negative means earlier. */
  snapshotOffset: number | null
  point: ReviewPoint | null
}

/** Kills that happened close together in time and space. */
export interface ReviewFight {
  start: number
  end: number
  /** Centre of the located kills; it can lie between the places where they happened. */
  point: ReviewPoint | null
  /** Where each located kill of the fight happened, in order. */
  killPoints: ReviewPoint[]
  /** Champions that died on the enemy side and on the reviewed player's side. */
  kills: number
  deaths: number
  /**
   * How many of those were executed (turret, minion or monster, no champion credited), which
   * is nobody's kill. Absent when none.
   */
  enemyExecutions?: number
  allyExecutions?: number
  /** Distinct champions credited on each side: killers, assistants and victims. */
  allies: number
  enemies: number
  ownKills: number
  ownAssists: number
  /** 1 when the reviewed player died first on their team, 2 for second...; null if they survived. */
  ownDeathOrder: number | null
  /** Objectives within 60 seconds after the last kill: indexes into `ReviewReport.objectives`. */
  objectivesAfter: number[]
}

export interface ReviewWardEvent {
  timestamp: number
  wardType: string
}

export interface ReviewVision {
  /**
   * Own placements of trinket wards, control wards and support-item wards. Other entries of the
   * timeline (UNDEFINED, champion traps) are left out, which matches the summary's ward count.
   */
  placed: ReviewWardEvent[]
  /** Wards of the same kinds that the reviewed player cleared. */
  cleared: ReviewWardEvent[]
}

/** One turret plate falling. */
export interface ReviewPlate {
  timestamp: number
  lane: string | null
  /** True when the reviewed player's team took it; null when the record does not say whose turret. */
  own: boolean | null
  /** The reviewed player is recorded as the one who broke it. */
  byPlayer: boolean
}

/** What the timeline says about a kill beyond the kill itself. */
export interface ReviewKillMark {
  timestamp: number
  killerId: number
  /** 2 for a double kill, 3 for a triple…; null when this mark is only an ace. */
  multiKill: number | null
  /** The kill took down the last living enemy. */
  ace: boolean
}

/** A period in which the trailing team could collect bounties on objectives. */
export interface ReviewObjectiveBounty {
  /** When the bounty was announced and when it went live. */
  announcedAt: number
  start: number
  /** Null when it was still running at the end of the game. */
  end: number | null
  /** True when the reviewed player's team was the one that could collect; null if unknown. */
  own: boolean | null
}

/**
 * Everything the summary and the timeline record about one game from the reviewed player's
 * side. Lives in memory with a freshly parsed match; archives keep only `ReviewDigest`.
 */
export interface ReviewReport {
  /** False when the event log could not be reconciled with the summary: lists may miss entries. */
  complete: boolean
  /** The game ended by a surrender vote; null when the summary does not say. */
  surrendered: boolean | null
  players: ReviewPlayerLine[]
  teams: ReviewTeamLine[]
  build: ReviewBuild
  /** The lane opponent's purchases and level-ups; null without an identified lane opponent. */
  opponentBuild: ReviewBuild | null
  /** Null when the summary does not say what the player queued for. */
  assignment: ReviewRoleAssignment | null
  /** The element the rift turned into, which is also the dragon soul on offer; null if it never did. */
  riftElement: { timestamp: number; name: string } | null
  plates: ReviewPlate[]
  bounties: ReviewObjectiveBounty[]
  /** Multi-kills and aces the timeline marks, for any of the ten players, in time order. */
  killMarks: ReviewKillMark[]
  levels: ReviewLevelTiming[]
  checkpoints: ReviewCheckpoint[]
  takedowns: ReviewTakedown[]
  deaths: ReviewDeathDetail[]
  objectives: ReviewObjective[]
  fights: ReviewFight[]
  vision: ReviewVision
}

/**
 * One game reduced to plain numbers for cross-game averages. Every value is null when the
 * game cannot prove it; nothing is filled in with zero.
 */
export interface ReviewDigest {
  metrics: Record<string, number | null>
  /** First three completed items with purchase times. */
  coreItems: Array<{ timestamp: number; itemId: number }>
  bootsItemId: number | null
  keystone: number | null
  summonerSpells: number[]
  skillPriority: Array<1 | 2 | 3> | null
  /** The server's own challenge counters for the reviewed player; null when the summary has none. */
  challenges: Record<string, number> | null
  /**
   * The rune page with the three numbers the server recorded for each rune, one entry
   * `[rune, n1, n2, n3]` per rune in page order (keystone first). Kept so that a later game can
   * be told whether a rune did more or less than it usually does. Missing in archives saved
   * before runes were kept.
   */
  runes?: number[][] | null
}

export interface ReviewMatch {
  meta: {
    gameId: number
    sgpServerId: string
    puuid: string
    gameCreation: number
    gameDuration: number
    queueId: number
    patch: string
    championId: number
    position: ReviewPosition
    participantId: number
    teamId: 100 | 200
    opponentId: number | null
    opponentChampionId: number | null
    win: boolean
  }
  participants: ReviewParticipant[]
  frames: ReviewFrame[]
  events: ReviewEvent[]
  moments: ReviewMoment[]
  snapshots: ReviewSnapshot[]
  quality: ReviewQuality
  /** Own deaths with coordinates. Missing in archives saved before the death map existed. */
  deaths?: ReviewDeath[] | null
  /** Missing in archives saved before the win/loss comparison existed. */
  early?: ReviewEarlyFacts | null
  /** Full single-game report; only on freshly parsed matches, never archived. */
  report?: ReviewReport | null
  /** Missing in archives saved before the game digest existed. */
  digest?: ReviewDigest | null
}

export type ReviewParseResult = { ok: true; match: ReviewMatch } | { ok: false; reason: string }

export interface ReviewFilter {
  championId?: number | null
  position?: ReviewPosition | null
  opponentChampionId?: number | null
  patch?: string | null
  queueId?: number | null
}

export interface ReviewMetric {
  mean: number | null
  samples: number
  min: number | null
  max: number | null
  /** Sample standard deviation; null below two observations. */
  standardDeviation: number | null
}

export interface ReviewSampleStats {
  games: number
  wins: number
  winRate: number | null
  gold10: ReviewMetric
  gold15: ReviewMetric
  cs10: ReviewMetric
  cs15: ReviewMetric
  teamGold10: ReviewMetric
  teamGold15: ReviewMetric
}

export interface ReviewMatchupGroup extends ReviewSampleStats {
  championId: number
  position: ReviewPosition
  opponentChampionId: number | null
  matches: ReviewMatch[]
}

export interface ReviewTrend {
  /** Disjoint groups with equal game counts, each at most 20. */
  recent: ReviewSampleStats
  previous: ReviewSampleStats
  recentMatches: ReviewMatch[]
  previousMatches: ReviewMatch[]
}

export interface ReviewConversionEntry {
  match: ReviewMatch
  /** Earliest qualified 10/15-minute checkpoint. */
  checkpoint: 10 | 15
  personalLead: boolean
  teamLead: boolean
  snapshots: ReviewSnapshot[]
  deaths: ReviewEvent[]
  enemyObjectives: ReviewEvent[]
}

export interface ReviewConversionStats {
  games: number
  wins: number
  winRate: number | null
  eligibleGames: number
  excludedGames: number
  entries: ReviewConversionEntry[]
}

export interface ReviewConversionOptions {
  checkpoint?: 10 | 15 | 'either'
  scope?: 'personal' | 'team' | 'either'
  outcome?: 'all' | 'win' | 'loss'
}
