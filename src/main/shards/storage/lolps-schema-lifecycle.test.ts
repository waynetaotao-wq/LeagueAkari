import type { DataSource } from 'typeorm'
import { afterEach, describe, expect, it } from 'vitest'

import type { StorageMainContext } from './context'
import { RankLogEntry } from './entities/RankLogEntry'
import {
  LOLPS_SCHEMA_CURRENT_VERSION,
  LOLPS_SCHEMA_VERSION_KEY,
  StorageLolpsSchemaLifecycle
} from './lolps-schema-lifecycle'
import {
  createStorageTestContext as createContext,
  createTestDataSource,
  isSqliteAvailable
} from './test-database'

const dataSources: DataSource[] = []

/** A real in-memory SQLite database without this fork's tables; the tests add them. */
async function createDatabase(context: StorageMainContext, withOfficialSchema = true) {
  const dataSource = await createTestDataSource(context, { official: withOfficialSchema })
  dataSources.push(dataSource)
  return dataSource
}

/** Metadata values are JSON; SQLite hands a bare number back as a number. */
const metadata = async (dataSource: DataSource, key: string) => {
  const rows = await dataSource.query(`SELECT value FROM Metadata WHERE key = '${key}'`)
  return rows.length ? Number(rows[0].value) : undefined
}

const entry = (values: Partial<RankLogEntry> = {}) =>
  Object.assign(new RankLogEntry(), {
    puuid: 'self',
    sgpServerId: 'NA1',
    kind: 'game',
    queueType: 'RANKED_SOLO_5x5',
    occurredAt: 1_700_000_000_000,
    ...values
  })

afterEach(async () => {
  await Promise.all(
    dataSources.splice(0).map((dataSource) => dataSource.isInitialized && dataSource.destroy())
  )
})

describe.skipIf(!isSqliteAvailable)('StorageLolpsSchemaLifecycle', () => {
  it('creates the rank log table next to the official schema without touching its version', async () => {
    const { context } = createContext()
    const dataSource = await createDatabase(context)

    await expect(new StorageLolpsSchemaLifecycle(context).initialize(dataSource)).resolves.toBe(
      true
    )

    expect(await metadata(dataSource, 'version')).toBe(15)
    expect(await metadata(dataSource, LOLPS_SCHEMA_VERSION_KEY)).toBe(LOLPS_SCHEMA_CURRENT_VERSION)
    const columns: { name: string; notnull: number }[] = await dataSource.query(
      `PRAGMA table_info('RankLogEntries')`
    )
    // 表里的列必须和实体声明的完全一致，否则读写时才会报错。
    expect(columns.map((column) => column.name).toSorted()).toEqual(
      dataSource
        .getMetadata(RankLogEntry)
        .columns.map((column) => column.databaseName)
        .toSorted()
    )
    expect(columns.filter((column) => column.notnull).map((column) => column.name)).toEqual(
      expect.arrayContaining(['puuid', 'sgpServerId', 'kind', 'queueType', 'occurredAt'])
    )
    const indexes: { name: string; unique: number }[] = await dataSource.query(
      `PRAGMA index_list('RankLogEntries')`
    )
    expect(indexes.map((index) => [index.name, index.unique])).toEqual(
      expect.arrayContaining([
        ['rank_log_entries_game_unique', 1],
        ['rank_log_entries_owner_time_index', 0]
      ])
    )
  })

  it('does nothing on the next start', async () => {
    const { context, logger } = createContext()
    const dataSource = await createDatabase(context)
    const lifecycle = new StorageLolpsSchemaLifecycle(context)
    await lifecycle.initialize(dataSource)
    await dataSource.manager.save(entry({ gameId: 7 }))
    logger.info.mockClear()

    await expect(lifecycle.initialize(dataSource)).resolves.toBe(true)

    expect(logger.info).not.toHaveBeenCalled()
    expect(await dataSource.manager.count(RankLogEntry)).toBe(1)
  })

  it('stores every column and reads it back with its type', async () => {
    const { context } = createContext()
    const dataSource = await createDatabase(context)
    await new StorageLolpsSchemaLifecycle(context).initialize(dataSource)
    const saved = await dataSource.manager.save(
      entry({
        observedAt: 1_700_000_100_000,
        gameId: 5_123_456_789,
        gameCreation: 1_699_999_000_000,
        gameDuration: 1810,
        championId: 103,
        position: 'MIDDLE',
        win: true,
        remake: false,
        kills: 7,
        deaths: 2,
        assists: 9,
        cs: 201,
        games: null,
        lpDelta: -23,
        tier: 'EMERALD',
        division: 'II',
        leaguePoints: 15,
        absoluteLp: 2215,
        provisional: false,
        wins: 64,
        losses: 58
      })
    )

    const loaded = await dataSource.manager.findOneByOrFail(RankLogEntry, { id: saved.id })

    expect(loaded).toMatchObject({
      gameId: 5_123_456_789,
      occurredAt: 1_700_000_000_000,
      win: true,
      remake: false,
      provisional: false,
      games: null,
      lpDelta: -23,
      absoluteLp: 2215
    })
  })

  it('keeps one row per game and any number of rows without a game', async () => {
    const { context } = createContext()
    const dataSource = await createDatabase(context)
    await new StorageLolpsSchemaLifecycle(context).initialize(dataSource)
    await dataSource.manager.save(entry({ gameId: 7 }))

    await expect(dataSource.manager.save(entry({ gameId: 7 }))).rejects.toThrow()
    await dataSource.manager.save(entry({ gameId: 7, puuid: 'another account' }))
    await dataSource.manager.save(entry({ gameId: 7, sgpServerId: 'EUW1' }))
    await dataSource.manager.save(entry({ kind: 'baseline', gameId: null }))
    await dataSource.manager.save(entry({ kind: 'adjustment', gameId: null }))

    expect(await dataSource.manager.count(RankLogEntry)).toBe(5)
  })

  it('stays unavailable instead of failing the start when the official tables are missing', async () => {
    const { context, logger } = createContext()
    const dataSource = await createDatabase(context, false)

    await expect(new StorageLolpsSchemaLifecycle(context).initialize(dataSource)).resolves.toBe(
      false
    )

    expect(logger.warn).toHaveBeenCalledOnce()
    expect(await dataSource.query(`SELECT name FROM sqlite_master WHERE type = 'table'`)).toEqual(
      []
    )
  })

  it('rolls a failed upgrade back and reports the tables as unavailable', async () => {
    const { context, logger } = createContext()
    const dataSource = await createDatabase(context)
    // 占住索引名，让升级在建完表之后失败。
    await dataSource.query(`CREATE TABLE Blocker (id integer)`)
    await dataSource.query(`CREATE INDEX rank_log_entries_game_unique ON Blocker (id)`)

    await expect(new StorageLolpsSchemaLifecycle(context).initialize(dataSource)).resolves.toBe(
      false
    )

    expect(logger.error).toHaveBeenCalledOnce()
    expect(await metadata(dataSource, LOLPS_SCHEMA_VERSION_KEY)).toBeUndefined()
    expect(
      await dataSource.query(`SELECT name FROM sqlite_master WHERE name = 'RankLogEntries'`)
    ).toEqual([])
    expect(await metadata(dataSource, 'version')).toBe(15)
  })
})
