import type {
  BuildingType,
  DamageDetail,
  DetailedGameEvent,
  DetailedParticipantFrame,
  LaneType,
  SgpGameDetailsLol,
  SgpGameSummaryLol,
  SgpParticipantLol,
  TowerType
} from '@shared/types/sgp/match-history'

// [lolps] 最小服务端夹具；不填充与复盘无关的战绩字段。
export function createReviewFixture(
  options: { gameId?: number; duration?: number; win?: boolean } = {}
) {
  const gameId = options.gameId ?? 12345
  const duration = options.duration ?? 1500
  const ids = [8, 2, 10, 4, 6, 3, 1, 9, 5, 7]
  const roles = ['MIDDLE', 'TOP', 'JUNGLE', 'BOTTOM', 'UTILITY']
  const participants = ids.map(
    (participantId, index) =>
      ({
        participantId,
        puuid: `player-${participantId}`,
        championId: index === 0 ? 238 : index === 5 ? 103 : participantId + 100,
        championName: index === 0 ? 'Zed' : index === 5 ? 'Ahri' : `Champion${participantId}`,
        teamId: index < 5 ? 100 : 200,
        teamPosition: roles[index % 5],
        individualPosition: roles[index % 5],
        summonerName: `Player${participantId}`,
        riotIdGameName: `Player${participantId}`,
        riotIdTagline: 'TEST',
        win: index < 5 ? (options.win ?? true) : !(options.win ?? true),
        deaths: 0,
        gameEndedInEarlySurrender: false
      }) as SgpParticipantLol
  )
  const metadata = {
    product: 'LOL',
    tags: [],
    participants: participants.map((p) => p.puuid),
    timestamp: '2026-09-01T00:00:00Z',
    data_version: '2',
    info_type: 'summary',
    match_id: `TEST_${gameId}`,
    private: false
  }
  const summary: SgpGameSummaryLol = {
    metadata,
    json: {
      endOfGameResult: 'GameComplete',
      gameCreation: 1_780_000_000_000 + gameId,
      gameDuration: duration,
      gameEndTimestamp: 1_780_000_000_000 + duration * 1000,
      gameId,
      gameMode: 'CLASSIC',
      gameName: '',
      gameStartTimestamp: 1_780_000_000_000,
      gameType: 'MATCHED_GAME',
      gameVersion: '16.17.1',
      mapId: 11,
      participants,
      platformId: 'TEST',
      queueId: 420,
      seasonId: 16,
      teams: [],
      tournamentCode: ''
    }
  }
  const details: SgpGameDetailsLol = {
    metadata: { ...metadata, info_type: 'timeline' },
    json: {
      endOfGameResult: 'GameComplete',
      frameInterval: 60_000,
      gameId,
      participants: participants.map(({ participantId, puuid }) => ({ participantId, puuid })),
      frames: Array.from({ length: Math.floor(duration / 60) + 1 }, (_, minute) => ({
        timestamp: minute * 60_000,
        events: [],
        participantFrames: Object.fromEntries(
          participants.map((p) => [
            String(p.participantId),
            {
              participantId: p.participantId,
              totalGold:
                500 +
                minute * 300 +
                (p.participantId === 8 ? minute * 60 : p.teamId === 100 ? minute * 30 : 0),
              minionsKilled: minute * (p.participantId === 8 ? 8 : 7),
              jungleMinionsKilled: 0,
              position: { x: 7000 + p.participantId * 10, y: 7000 },
              level: Math.min(18, 1 + Math.floor(minute / 2)),
              championStats: { health: 800 }
            } as DetailedParticipantFrame
          ])
        )
      }))
    }
  }
  return { summary, details, puuid: 'player-8', sgpServerId: 'TEST' }
}

export function addReviewEvent(details: SgpGameDetailsLol, event: DetailedGameEvent) {
  const frame = details.json.frames.find((candidate) => candidate.timestamp >= event.timestamp)
  if (!frame) throw new Error('Fixture event exceeds timeline')
  frame.events.push(event)
}

export function reviewKill(timestamp: number, victimId = 8, shutdownBounty = 0): DetailedGameEvent {
  return {
    type: 'CHAMPION_KILL',
    timestamp,
    killerId: 3,
    victimId,
    assistingParticipantIds: [],
    position: { x: 7500, y: 7500 },
    bounty: 300,
    shutdownBounty,
    killStreakLength: 0,
    victimDamageReceived: []
  }
}

export function reviewPurchase(
  timestamp: number,
  itemId: number,
  participantId = 8
): DetailedGameEvent {
  return { type: 'ITEM_PURCHASED', timestamp, participantId, itemId }
}

/** Undoing a purchase, in the shape observed in real timelines: beforeId = item, afterId = 0. */
export function reviewUndo(
  timestamp: number,
  itemId: number,
  participantId = 8
): DetailedGameEvent {
  return { type: 'ITEM_UNDO', timestamp, participantId, beforeId: itemId, afterId: 0, goldGain: 0 }
}

export function reviewWard(
  timestamp: number,
  wardType = 'YELLOW_TRINKET',
  creatorId = 8
): DetailedGameEvent {
  return { type: 'WARD_PLACED', timestamp, creatorId, wardType }
}

/** teamId is the team that owns the damaged turret, as in real timelines. */
export function reviewPlate(
  timestamp: number,
  teamId: number,
  laneType: LaneType = 'MID_LANE'
): DetailedGameEvent {
  return {
    type: 'TURRET_PLATE_DESTROYED',
    timestamp,
    killerId: 0,
    laneType,
    position: teamId === 100 ? { x: 5846, y: 6396 } : { x: 8955, y: 8510 },
    teamId
  }
}

export function reviewDragon(timestamp: number, killerId = 3): DetailedGameEvent {
  return {
    type: 'ELITE_MONSTER_KILL',
    timestamp,
    killerId,
    monsterType: 'DRAGON',
    position: { x: 9866, y: 4414 }
  }
}

/** A champion kill with every credited player spelled out. killerId 0 is a turret or minion. */
export function reviewTakedown(
  timestamp: number,
  killerId: number,
  victimId: number,
  options: {
    assists?: number[]
    position?: { x: number; y: number }
    received?: Partial<DamageDetail>[]
    dealt?: Partial<DamageDetail>[]
    bounty?: number
    shutdownBounty?: number
  } = {}
): DetailedGameEvent {
  const damage = (entry: Partial<DamageDetail>): DamageDetail => ({
    basic: false,
    magicDamage: 0,
    name: '',
    participantId: 0,
    physicalDamage: 0,
    spellName: '',
    spellSlot: -1,
    trueDamage: 0,
    type: 'OTHER',
    ...entry
  })
  return {
    type: 'CHAMPION_KILL',
    timestamp,
    killerId,
    victimId,
    assistingParticipantIds: options.assists ?? [],
    position: options.position ?? { x: 7500, y: 7500 },
    bounty: options.bounty ?? 300,
    shutdownBounty: options.shutdownBounty ?? 0,
    killStreakLength: 0,
    victimDamageReceived: (options.received ?? []).map(damage),
    ...(options.dealt ? { victimDamageDealt: options.dealt.map(damage) } : {})
  }
}

export function reviewMonster(
  timestamp: number,
  monsterType: string,
  killerId: number,
  options: {
    subType?: string
    assists?: number[]
    position?: { x: number; y: number } | null
    killerTeamId?: number
  } = {}
): DetailedGameEvent {
  return {
    type: 'ELITE_MONSTER_KILL',
    timestamp,
    killerId,
    monsterType,
    ...(options.subType ? { monsterSubType: options.subType } : {}),
    ...(options.assists ? { assistingParticipantIds: options.assists } : {}),
    ...(options.killerTeamId ? { killerTeamId: options.killerTeamId } : {}),
    ...(options.position === null ? {} : { position: options.position ?? { x: 9866, y: 4414 } })
  }
}

/** teamId is the team that owns the destroyed building, as in real timelines. */
export function reviewBuilding(
  timestamp: number,
  teamId: number,
  killerId: number,
  options: {
    buildingType?: BuildingType
    towerType?: TowerType
    laneType?: LaneType
    assists?: number[]
    position?: { x: number; y: number }
  } = {}
): DetailedGameEvent {
  const buildingType = options.buildingType ?? 'TOWER_BUILDING'
  return {
    type: 'BUILDING_KILL',
    timestamp,
    killerId,
    teamId,
    bounty: 0,
    buildingType,
    laneType: options.laneType ?? 'MID_LANE',
    position: options.position ?? (teamId === 100 ? { x: 5846, y: 6396 } : { x: 8955, y: 8510 }),
    ...(buildingType === 'TOWER_BUILDING'
      ? { towerType: options.towerType ?? 'OUTER_TURRET' }
      : {}),
    ...(options.assists ? { assistingParticipantIds: options.assists } : {})
  }
}

export function reviewLevelUp(
  timestamp: number,
  level: number,
  participantId = 8
): DetailedGameEvent {
  return { type: 'LEVEL_UP', timestamp, participantId, level }
}

/** skillSlot 1-4 is Q, W, E, R. */
export function reviewSkill(
  timestamp: number,
  skillSlot: number,
  participantId = 8,
  levelUpType: 'NORMAL' | 'EVOLVE' = 'NORMAL'
): DetailedGameEvent {
  return { type: 'SKILL_LEVEL_UP', timestamp, participantId, skillSlot, levelUpType }
}

export function reviewSale(
  timestamp: number,
  itemId: number,
  participantId = 8
): DetailedGameEvent {
  return { type: 'ITEM_SOLD', timestamp, participantId, itemId }
}

/** Undoing a sale, the mirror of an undone purchase: beforeId = 0, afterId = item. */
export function reviewUndoSale(
  timestamp: number,
  itemId: number,
  participantId = 8
): DetailedGameEvent {
  return { type: 'ITEM_UNDO', timestamp, participantId, beforeId: 0, afterId: itemId, goldGain: 0 }
}

export function reviewWardKill(
  timestamp: number,
  wardType = 'SIGHT_WARD',
  killerId = 8
): DetailedGameEvent {
  return { type: 'WARD_KILL', timestamp, killerId, wardType }
}

/** Overwrites summary fields of one participant and returns it. */
export function setReviewStats(
  summary: SgpGameSummaryLol,
  participantId: number,
  values: Partial<SgpParticipantLol>
) {
  const participant = summary.json.participants.find((p) => p.participantId === participantId)
  if (!participant) throw new Error('Fixture participant missing')
  return Object.assign(participant, values)
}
