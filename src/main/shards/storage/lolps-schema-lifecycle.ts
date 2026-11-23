import type { DataSource, QueryRunner } from 'typeorm'

import type { StorageMainContext } from './context'
import { lolpsV1_RankLogUpgrade } from './upgrades/lolps-version-1'

export const LOLPS_SCHEMA_VERSION_KEY = 'lolps-schema-version'
export const LOLPS_SCHEMA_CURRENT_VERSION = 1

/**
 * [lolps] 定制版自己的表结构升级链。
 *
 * 它不动官方的数据库版本号（Metadata 里的 version），只在 Metadata 里另记一个
 * `lolps-schema-version`。这样官方以后发布自己的下一个数据库版本时不会和这里撞号，
 * 旧版本程序打开数据库也只是多出几张它不认识的表。
 * 升级失败不会影响程序启动：定制表不可用，依赖它的功能自行停用。
 */
export class StorageLolpsSchemaLifecycle {
  private readonly _upgrades: Record<number, (queryRunner: QueryRunner) => Promise<void>> = {
    1: lolpsV1_RankLogUpgrade
  }

  constructor(private readonly _context: StorageMainContext) {}

  /** @returns whether the fork's own tables exist and can be used */
  async initialize(dataSource: DataSource) {
    const { logger } = this._context
    const queryRunner = dataSource.createQueryRunner()
    let isTransactionStarted = false

    try {
      if (!(await queryRunner.getTable('Metadata'))) {
        logger.warn('[lolps] Metadata table is missing, fork tables stay unavailable')
        return false
      }

      const rows: { value: unknown }[] = await queryRunner.query(
        `SELECT value FROM Metadata WHERE key = '${LOLPS_SCHEMA_VERSION_KEY}'`
      )
      const currentVersion = rows.length ? parseInt(String(rows[0].value), 10) || 0 : 0
      const pendingUpgrades = Object.entries(this._upgrades)
        .filter(([version]) => Number(version) > currentVersion)
        .toSorted(([first], [second]) => Number(first) - Number(second))

      if (!pendingUpgrades.length) {
        return true
      }

      logger.info(
        `[lolps] Fork schema needs to be upgraded from version ${currentVersion}, steps: ${pendingUpgrades.length}`
      )
      await queryRunner.startTransaction()
      isTransactionStarted = true

      for (const [version, upgrade] of pendingUpgrades) {
        logger.info(`[lolps] Executing => fork schema version ${version}`)
        await upgrade(queryRunner)
      }

      await queryRunner.query(
        `INSERT INTO Metadata (key, value) VALUES ('${LOLPS_SCHEMA_VERSION_KEY}', json('${LOLPS_SCHEMA_CURRENT_VERSION}'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      await queryRunner.commitTransaction()
      logger.info(`[lolps] Fork schema is now at version ${LOLPS_SCHEMA_CURRENT_VERSION}`)
      return true
    } catch (error) {
      if (isTransactionStarted) {
        await queryRunner.rollbackTransaction().catch(() => {})
      }
      logger.error('[lolps] Fork schema upgrade failed, fork tables stay unavailable', error)
      return false
    } finally {
      await queryRunner.release()
    }
  }
}
