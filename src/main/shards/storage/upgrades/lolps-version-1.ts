import { QueryRunner, Table, TableIndex } from 'typeorm'

/**
 * [lolps] 定制版表结构 Version 1 - 新建上分日志表 RankLogEntries
 */
export async function lolpsV1_RankLogUpgrade(queryRunner: QueryRunner) {
  const nullableInteger = (name: string) => ({ name, type: 'integer', isNullable: true })
  const nullableText = (name: string) => ({ name, type: 'varchar', isNullable: true })
  const nullableBoolean = (name: string) => ({ name, type: 'boolean', isNullable: true })

  await queryRunner.createTable(
    new Table({
      name: 'RankLogEntries',
      columns: [
        {
          name: 'id',
          type: 'integer',
          isPrimary: true,
          isGenerated: true,
          generationStrategy: 'increment'
        },
        { name: 'puuid', type: 'varchar', isNullable: false },
        { name: 'sgpServerId', type: 'varchar', isNullable: false },
        { name: 'kind', type: 'varchar', isNullable: false },
        { name: 'queueType', type: 'varchar', isNullable: false },
        { name: 'occurredAt', type: 'integer', isNullable: false },
        nullableInteger('observedAt'),
        nullableInteger('gameId'),
        nullableInteger('gameCreation'),
        nullableInteger('gameDuration'),
        nullableInteger('championId'),
        nullableText('position'),
        nullableBoolean('win'),
        nullableBoolean('remake'),
        nullableInteger('kills'),
        nullableInteger('deaths'),
        nullableInteger('assists'),
        nullableInteger('cs'),
        nullableInteger('games'),
        nullableInteger('lpDelta'),
        nullableText('tier'),
        nullableText('division'),
        nullableInteger('leaguePoints'),
        nullableInteger('absoluteLp'),
        nullableBoolean('provisional'),
        nullableInteger('wins'),
        nullableInteger('losses')
      ]
    })
  )

  // 同一账号的同一局只留一行；没有对局编号的行（起点、漏记、变动）不受这条约束。
  await queryRunner.createIndex(
    'RankLogEntries',
    new TableIndex({
      name: 'rank_log_entries_game_unique',
      columnNames: ['puuid', 'sgpServerId', 'gameId'],
      isUnique: true
    })
  )

  await queryRunner.createIndex(
    'RankLogEntries',
    new TableIndex({
      name: 'rank_log_entries_owner_time_index',
      columnNames: ['puuid', 'sgpServerId', 'occurredAt']
    })
  )
}
