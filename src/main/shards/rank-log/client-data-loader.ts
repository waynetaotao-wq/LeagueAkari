import {
  type RankLogGameFacts,
  type RankSnapshot,
  readRankLogGame,
  readRankSnapshots
} from '@shared/shards/rank-log'

import type { RankLogMainContext, RankLogOwner } from './context'

/** Reads the current rank from the client and ranked games from match history. Read-only. */
export class RankLogClientDataLoader {
  constructor(private readonly _context: RankLogMainContext) {}

  /** The logged-in player's ranked Rift queues as the client reports them right now. */
  async loadSnapshots(): Promise<RankSnapshot[]> {
    const { data } = await this._context.leagueClient.api.ranked.getCurrentRankedStats()
    return readRankSnapshots(data)
  }

  /** Match history needs the regional service to be configured and the login tokens to be in. */
  canLoadHistory() {
    const { sgp } = this._context
    return sgp.state.isTokenReady && sgp.state.availability.serversSupported.matchHistory
  }

  /** The player's most recent ranked Rift games, newest first as the server returns them. */
  async loadHistory(owner: RankLogOwner, count: number): Promise<RankLogGameFacts[]> {
    const { data } =
      await this._context.sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid(
        owner.puuid,
        { startIndex: 0, count }
      )
    return data.games.flatMap((game) => {
      const facts = readRankLogGame(game, owner.puuid)
      return facts ? [facts] : []
    })
  }
}
