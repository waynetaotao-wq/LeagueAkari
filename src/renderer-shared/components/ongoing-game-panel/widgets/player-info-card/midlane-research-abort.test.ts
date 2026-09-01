import { describe, expect, it } from 'vitest'

import { analyzeDeep, collectVersionLadder } from './midlane-research'

/**
 * 宿主组件在依赖变化 / 卡片隐藏 / 卸载时通过 AbortSignal 中止在途研究；
 * 这里钉住算法层对 signal 的响应：中止后不再发起新的分页与时间线请求。
 */
describe('midlane research abort contract', () => {
  it('collectVersionLadder stops paging once the signal is aborted', async () => {
    const controller = new AbortController()
    let pages = 0
    const getPage = async () => {
      pages++
      if (pages === 2) controller.abort()
      // 每页返回同版本的中路对局，永远凑不满目标数，只能靠中止或翻页上限停下
      return {
        games: Array.from({ length: 20 }, (_, i) => ({
          json: {
            gameId: pages * 100 + i,
            gameVersion: '16.17.1',
            gameCreation: 1_700_000_000_000 - i,
            queueId: 420,
            gameDuration: 1800,
            participants: [
              { puuid: 'p', championId: 238, teamId: 100, individualPosition: 'MIDDLE', teamPosition: 'MIDDLE', win: true }
            ]
          }
        }))
      }
    }
    await collectVersionLadder(getPage, 'p', 238, { target: 500, maxPages: 50 }, undefined, controller.signal)
    expect(pages).toBeLessThanOrEqual(3)
  })

  it('analyzeDeep does not fetch every timeline after abort', async () => {
    const controller = new AbortController()
    const games = Array.from({ length: 30 }, (_, i) => ({
      gameId: i + 1,
      gameCreation: 1_700_000_000_000 - i,
      win: true,
      participants: []
    })) as any[]
    let fetched = 0
    const getTimeline = async () => {
      fetched++
      if (fetched === 3) controller.abort()
      return { frames: [] }
    }
    await analyzeDeep(games, getTimeline, { deepGames: 30 }, undefined, controller.signal)
    expect(fetched).toBeLessThan(30)
  })
})
