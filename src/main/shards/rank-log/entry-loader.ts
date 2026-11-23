import {
  type RankLogEntryDto,
  type RankLogQueryDto,
  type RankLogQueueType,
  normalizeRankLogLimit
} from '@shared/shards/rank-log'
import { type FindOptionsWhere, IsNull, LessThanOrEqual, Not } from 'typeorm'

import type { StorageMain } from '../storage'
import { RankLogEntry } from '../storage/entities/RankLogEntry'
import type { RankLogOwner } from './context'

/** Reads and writes the rank log rows of one account. All queries are scoped by owner. */
export class RankLogEntryLoader {
  constructor(private readonly _storage: StorageMain) {}

  private get _manager() {
    return this._storage.dataSource.manager
  }

  /** Newest first. */
  async query(query: RankLogQueryDto): Promise<RankLogEntryDto[]> {
    const where: FindOptionsWhere<RankLogEntry> = {
      puuid: query.puuid,
      sgpServerId: query.sgpServerId
    }
    if (query.queueType) {
      where.queueType = query.queueType
    }

    const entries = await this._manager.find(RankLogEntry, {
      where,
      order: { occurredAt: 'DESC', id: 'DESC' },
      take: normalizeRankLogLimit(query.limit)
    })
    return entries.map(({ puuid: _puuid, sgpServerId: _sgpServerId, ...entry }) => entry)
  }

  /** The most recent row that carries a rank reading for this queue. */
  findLatestSnapshot(owner: RankLogOwner, queueType: RankLogQueueType) {
    return this._manager.findOne(RankLogEntry, {
      where: { ...owner, queueType, observedAt: Not(IsNull()) },
      order: { observedAt: 'DESC', id: 'DESC' }
    })
  }

  /** The rank reading right before the given row's reading, in the same queue. */
  async findSnapshotBefore(entry: RankLogEntry) {
    if (entry.observedAt === null) {
      return null
    }

    const candidates = await this._manager.find(RankLogEntry, {
      where: {
        puuid: entry.puuid,
        sgpServerId: entry.sgpServerId,
        queueType: entry.queueType,
        observedAt: LessThanOrEqual(entry.observedAt)
      },
      order: { observedAt: 'DESC', id: 'DESC' },
      take: 4
    })
    return (
      candidates.find(
        (candidate) =>
          candidate.id !== entry.id &&
          (candidate.observedAt! < entry.observedAt! || candidate.id < entry.id)
      ) ?? null
    )
  }

  findGame(owner: RankLogOwner, gameId: number) {
    return this._manager.findOne(RankLogEntry, { where: { ...owner, gameId } })
  }

  /** History games that no rank change has been attached to yet. */
  findUnattributedGames(owner: RankLogOwner, queueType: RankLogQueueType) {
    return this._manager.find(RankLogEntry, {
      where: { ...owner, queueType, kind: 'game', gameId: Not(IsNull()), observedAt: IsNull() }
    })
  }

  /** Single-game rank changes whose game is not known yet, oldest first. */
  findUnidentifiedGames(owner: RankLogOwner) {
    return this._manager.find(RankLogEntry, {
      where: { ...owner, kind: 'game', gameId: IsNull() },
      order: { observedAt: 'ASC', id: 'ASC' }
    })
  }

  /** Whether some game row is still waiting for its champion, score and end time. */
  async hasGamesWithoutFacts(owner: RankLogOwner) {
    return (
      (await this._manager.count(RankLogEntry, {
        where: { ...owner, kind: 'game', gameId: Not(IsNull()), championId: IsNull() }
      })) > 0
    )
  }

  save(entry: RankLogEntry) {
    return this._manager.save(entry)
  }

  remove(entry: RankLogEntry) {
    return this._manager.remove(entry)
  }
}
