import { formatError } from '@shared/utils/errors'
import { isAxiosError } from 'axios'
import { compareStructural, computed } from 'mobx'

import type { AutoGameflowMainContext } from './context'

interface ReportTarget {
  puuid: string
  summonerId: number
  summonerName: string
}

/**
 * 赛后自动举报
 *
 * 触发时机与自动点赞相同：结算界面 honor.ballot 出现时（此时 LCU 已开放举报通道）。
 *
 * 三重排除（永远不举报）：
 *   1. 自己
 *   2. 同房间开黑的人（getEogStatus 的房间成员）
 *   3. 好友列表中的人
 *
 * 范围可选：仅敌方 / 敌我全部（默认仅敌方）。
 * 每局只执行一次（按 gameId 记忆），并会跳过客户端记录中已被举报过的人。
 */
export class AutoGameflowReportController {
  private _reportedGameIds = new Set<number>()

  constructor(private readonly _context: AutoGameflowMainContext) {}

  /**
   * 好友 puuid 集合。失败时返回 null 表示"不可信"，调用方将放弃本次举报，
   * 宁可不举报也绝不误伤好友。
   */
  private async _getFriendPuuids(): Promise<Set<string> | null> {
    const { leagueClient, logger } = this._context

    try {
      const { data } = await leagueClient.api.chat.getFriends()
      return new Set(data.map((f) => f.puuid).filter(Boolean))
    } catch (error) {
      logger.warn(`Auto-report: 获取好友列表失败: ${formatError(error)}`)
      return null
    }
  }

  /** 客户端记录中本局已被举报过的人（puuid 或 summonerId，两种都存进集合） */
  private async _getAlreadyReported(gameId: number): Promise<Set<string>> {
    const { leagueClient, logger } = this._context

    try {
      const { data } = await leagueClient.api.playerReportSender.getReportedPlayersByGameId(gameId)
      return new Set((data || []).map((v) => String(v)))
    } catch (error) {
      logger.info(`Auto-report: 查询已举报名单失败（不影响举报）: ${formatError(error)}`)
      return new Set<string>()
    }
  }

  private async _submitReport(gameId: number, target: ReportTarget, categories: string[]) {
    const { leagueClient } = this._context

    // 同时携带 puuid 与 summonerId，兼容不同客户端版本对字段的要求
    return leagueClient.http.post('/lol-player-report-sender/v1/end-of-game-reports', {
      gameId,
      offenderPuuid: target.puuid,
      offenderSummonerId: target.summonerId,
      categories,
      comment: ''
    })
  }

  watch() {
    const { ipc, leagueClient, logger, mobxUtils, namespace, settings } = this._context

    const reportables = computed(() => {
      if (!leagueClient.data.honor.ballot) {
        return null
      }

      const { eligibleAllies, eligibleOpponents, gameId } = leagueClient.data.honor.ballot

      const toTargets = (players: typeof eligibleAllies): ReportTarget[] =>
        players
          .filter((player) => !player.botPlayer)
          .map((player) => ({
            puuid: player.puuid,
            summonerId: player.summonerId,
            summonerName: player.summonerName
          }))

      return {
        allies: toTargets(eligibleAllies),
        opponents: toTargets(eligibleOpponents),
        gameId
      }
    })

    mobxUtils.reaction(
      () => [reportables.get(), settings.autoReportEnabled] as const,
      async ([data, enabled]) => {
        if (!data || !data.gameId || !enabled) {
          return
        }

        if (this._reportedGameIds.has(data.gameId)) {
          return
        }

        const categories = settings.autoReportCategories
        if (!categories || categories.length === 0) {
          logger.info('Auto-report: 未选择任何举报理由, 跳过')
          return
        }

        // 先占位, 防止同一局因状态抖动被重复执行
        this._reportedGameIds.add(data.gameId)
        if (this._reportedGameIds.size > 50) {
          this._reportedGameIds = new Set([...this._reportedGameIds].slice(-25))
        }

        try {
          // —— 排除名单 ——
          const excluded = new Set<string>()

          const me = leagueClient.data.summoner.me?.puuid
          if (me) {
            excluded.add(me)
          }

          // 好友（拿不到就整局放弃，避免误伤）
          const friends = await this._getFriendPuuids()
          if (!friends) {
            logger.warn('Auto-report: 好友列表不可用, 为避免误伤好友, 本局跳过举报')
            return
          }
          for (const puuid of friends) {
            excluded.add(puuid)
          }

          // 同房间开黑的人
          try {
            const eogStatus = (await leagueClient.api.lobby.getEogStatus()).data
            for (const puuid of [
              ...eogStatus.eogPlayers,
              ...eogStatus.leftPlayers,
              ...eogStatus.readyPlayers
            ]) {
              excluded.add(puuid)
            }
          } catch (error) {
            logger.warn(
              `Auto-report: 获取房间成员失败, 为避免误伤开黑队友, 本局跳过举报: ${formatError(error)}`
            )
            return
          }

          // —— 目标名单 ——
          const alreadyReported = await this._getAlreadyReported(data.gameId)

          const pool =
            settings.autoReportScope === 'all' ? [...data.allies, ...data.opponents] : data.opponents

          const seen = new Set<string>()
          const targets = pool.filter((t) => {
            if (!t.puuid || excluded.has(t.puuid) || seen.has(t.puuid)) {
              return false
            }
            if (alreadyReported.has(t.puuid) || alreadyReported.has(String(t.summonerId))) {
              return false
            }
            seen.add(t.puuid)
            return true
          })

          if (targets.length === 0) {
            logger.info(
              `Auto-report: 排除后无可举报对象 (排除名单 ${excluded.size} 人), game ID: ${data.gameId}`
            )
            return
          }

          let ok = 0
          const failures: string[] = []
          for (const target of targets) {
            try {
              await this._submitReport(data.gameId, target, categories)
              ok++
            } catch (error) {
              if (isAxiosError(error) && error.response) {
                failures.push(
                  `${target.summonerName}: HTTP ${error.response.status} ${JSON.stringify(
                    error.response.data
                  )}`
                )
              } else {
                failures.push(`${target.summonerName}: ${formatError(error)}`)
              }
            }
          }

          logger.info(
            `Auto-report: 已举报 ${ok}/${targets.length} 人, 范围 ${settings.autoReportScope}, 理由 ${categories.join(
              ','
            )}, game ID: ${data.gameId}`
          )

          if (failures.length) {
            logger.warn(`Auto-report: 失败明细 -> ${failures.join(' | ')}`)
          }
        } catch (error) {
          ipc.sendEvent(namespace, 'error-auto-report', formatError(error))
          logger.warn(`Auto-report error: ${formatError(error)}`)
        }
      },
      {
        equals: compareStructural,
        fireImmediately: true
      }
    )
  }
}
