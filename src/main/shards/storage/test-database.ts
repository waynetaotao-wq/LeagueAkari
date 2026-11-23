import { DataSource } from 'typeorm'
import { vi } from 'vitest'

import type { StorageMainContext } from './context'
import { StorageDatabaseLifecycle } from './database-lifecycle'
import { EncounteredGame } from './entities/EncounteredGame'
import { RankLogEntry } from './entities/RankLogEntry'
import { StorageLolpsSchemaLifecycle } from './lolps-schema-lifecycle'
import { StorageState } from './state'

/**
 * [lolps] 测试专用：用真实的内存 SQLite 跑建表和读写。
 *
 * 数据库驱动是原生模块，只在和它编译目标一致的运行时里才能加载。加载不了时，
 * 依赖真实数据库的测试整组跳过（测试报告里会显示 skipped），而不是报一串看不懂的错。
 */
export const isSqliteAvailable = (() => {
  try {
    const Database = require('better-sqlite3')
    new Database(':memory:').close()
    return true
  } catch {
    return false
  }
})()

export function createStorageTestContext() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const context: StorageMainContext = {
    namespace: 'storage-main',
    logger: logger as unknown as StorageMainContext['logger'],
    mobxUtils: {} as StorageMainContext['mobxUtils'],
    state: new StorageState()
  }
  return { context, logger }
}

/**
 * An empty in-memory database. `official` builds the upstream tables through the real upgrade
 * chain, `fork` adds this fork's own tables on top. The caller destroys the data source.
 */
export async function createTestDataSource(
  context: StorageMainContext = createStorageTestContext().context,
  schema: { official?: boolean; fork?: boolean } = { official: true, fork: true }
) {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    synchronize: false,
    entities: [EncounteredGame, RankLogEntry]
  })
  if (schema.official) {
    await new StorageDatabaseLifecycle(context).initialize(dataSource)
  } else {
    await dataSource.initialize()
  }
  if (schema.fork) {
    await new StorageLolpsSchemaLifecycle(context).initialize(dataSource)
  }
  return dataSource
}
