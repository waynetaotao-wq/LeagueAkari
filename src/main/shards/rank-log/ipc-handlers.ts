import type { RankLogQueryDto } from '@shared/shards/rank-log'

import type { RankLogMainContext } from './context'
import type { RankLogEntryLoader } from './entry-loader'
import type { RankLogController } from './rank-log-controller'

export class RankLogIpcHandlers {
  constructor(
    private readonly _context: RankLogMainContext,
    private readonly _entryLoader: RankLogEntryLoader,
    private readonly _controller: RankLogController
  ) {}

  register() {
    const { ipc, namespace, state } = this._context

    ipc.onCall(namespace, 'queryEntries', (_, query: RankLogQueryDto) => {
      if (!state.available || !query?.puuid || !query.sgpServerId) {
        return []
      }

      return this._entryLoader.query(query)
    })

    ipc.onCall(namespace, 'syncNow', () => {
      return this._controller.sync()
    })
  }
}
