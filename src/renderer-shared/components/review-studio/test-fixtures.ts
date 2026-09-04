import type {
  DetailedGameEvent,
  DetailedParticipantFrame,
  SgpGameDetailsLol,
  SgpGameSummaryLol,
  SgpParticipantLol
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

export function reviewDragon(timestamp: number, killerId = 3): DetailedGameEvent {
  return {
    type: 'ELITE_MONSTER_KILL',
    timestamp,
    killerId,
    monsterType: 'DRAGON',
    position: { x: 9866, y: 4414 }
  }
}
