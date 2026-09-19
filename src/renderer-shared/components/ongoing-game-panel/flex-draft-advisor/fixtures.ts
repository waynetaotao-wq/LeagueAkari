import type { OngoingGameProviderValue } from '@renderer-shared/providers/ongoing-game/types'
import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import { createDefaultOngoingGamePanelPlayerCardTagSettings } from '@shared/shards/ongoing-game/settings'
import type { ChampSelectSession, ChampSelectTeam } from '@shared/types/league-client/champ-select'

import { DRAFT_ROLES, type DraftRole } from './model'

/** Synthetic data for the preview and behavior tests; never installed in live state. */
export function createDraftFixture() {
  const member = (cellId: number): ChampSelectTeam => ({
    assignedPosition: DRAFT_ROLES[cellId % 5],
    cellId,
    championId: 0,
    championPickIntent: 0,
    gameName: cellId === 7 ? '对面中单' : `玩家${cellId + 1}`,
    internalName: '',
    isAutofilled: false,
    isHumanoid: true,
    nameVisibilityType: 'VISIBLE',
    obfuscatedPuuid: '',
    obfuscatedSummonerId: 0,
    pickMode: 0,
    pickTurn: cellId,
    playerAlias: '',
    playerType: 'PLAYER',
    puuid: `player-${cellId}`,
    selectedSkinId: 0,
    spell1Id: 4,
    spell2Id: 14,
    summonerId: cellId + 1,
    tagLine: 'TEST',
    team: cellId < 5 ? 1 : 2,
    wardSkinId: 0
  })
  const session: ChampSelectSession = {
    allowDuplicatePicks: false,
    allowLockedEvents: false,
    allowPlayerPickSameChampion: false,
    benchChampions: [],
    benchEnabled: false,
    boostableSkinCount: 0,
    counter: 0,
    disallowBanningTeammateHoveredChampions: true,
    isLegacyChampSelect: false,
    lockedEventIndex: -1,
    pickOrderSwaps: [],
    positionSwaps: [],
    showQuitButton: true,
    skipChampionSelect: false,
    allowBattleBoost: false,
    allowRerolling: false,
    allowSkinSelection: true,
    allowSubsetChampionPicks: false,
    hasSimultaneousBans: true,
    hasSimultaneousPicks: false,
    rerollsRemaining: 0,
    trades: [],
    chatDetails: {
      multiUserChatId: '',
      multiUserChatPassword: '',
      mucJwtDto: { channelClaim: '', domain: '', jwt: '', targetRegion: '' }
    },
    queueId: 440,
    id: 'draft-101',
    gameId: 101,
    isSpectating: false,
    isCustomGame: false,
    localPlayerCellId: 2,
    myTeam: Array.from({ length: 5 }, (_, i) => member(i)),
    theirTeam: Array.from({ length: 5 }, (_, i) => member(i + 5)),
    bans: { myTeamBans: [], theirTeamBans: [], numBans: 0 },
    actions: [
      Array.from({ length: 10 }, (_, i) => ({
        actorCellId: i,
        championId: 0,
        completed: false,
        id: i,
        isAllyAction: i < 5,
        isInProgress: true,
        type: 'ban',
        duration: 30_000,
        pickTurn: i
      }))
    ],
    timer: {
      phase: 'BAN_PICK',
      adjustedTimeLeftInPhase: 30_000,
      internalNowInEpochMs: 0,
      isInfinite: false,
      totalTimeInPhase: 30_000
    }
  }
  const game: OngoingGameProviderValue = {
    settings: {
      enabled: true,
      matchHistoryLoadCount: 50,
      orderPlayerBy: 'position',
      showChampionUsage: 'none',
      showMatchHistoryItemBorder: false,
      showJunglePathing: false,
      showJunglePathingForAllPlayers: false,
      playerCardTags: createDefaultOngoingGamePanelPlayerCardTagSettings()
    },
    queryStage: {
      phase: 'champ-select',
      gameInfo: { queueId: 440, queueType: 'RANKED_FLEX_SR', gameMode: 'CLASSIC', gameId: 101 }
    },
    draft: null,
    teams: {
      'TEAM-100': session.myTeam.map((p) => p.puuid),
      'TEAM-200': session.theirTeam.map((p) => p.puuid)
    },
    championSelections: {},
    positionAssignments: {},
    mergedPremadeTeamMap: {},
    analysis: null,
    summoner: {},
    rankedStats: {},
    championMastery: {},
    savedInfo: {},
    cachedGames: {},
    gameDetails: {},
    matchHistory: {},
    matchHistoryLoadingState: {},
    spells: {},
    isConnected: true,
    isSpectating: false,
    streamerMode: false,
    selfPuuid: 'player-2',
    reloadPlayer: () => {}
  }
  return { game, session }
}

export function historyFixture(
  puuid: string,
  champions: number[],
  role: DraftRole = 'middle',
  now = Date.now()
): LcuOrSgpGameSummary[] {
  return champions.map(
    (championId, index) =>
      ({
        source: 'sgp',
        gameId: index + 1,
        data: {
          json: {
            gameId: index + 1,
            gameCreation: now - (index + 1) * 3_600_000,
            gameDuration: 1800,
            queueId: 440,
            mapId: 11,
            gameMode: 'CLASSIC',
            endOfGameResult: 'GameComplete',
            participants: [
              {
                puuid,
                championId,
                teamPosition: role.toUpperCase(),
                win: index % 3 !== 0,
                gameEndedInEarlySurrender: false
              }
            ]
          }
        }
      }) as LcuOrSgpGameSummary
  )
}
