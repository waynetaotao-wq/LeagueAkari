import { reaction, runInAction } from 'mobx'
import { describe, expect, it, vi } from 'vitest'

import type { NetworkMainContext } from './context'
import { NetworkProxyController } from './proxy-controller'
import { NetworkSettings } from './state'

describe('NetworkProxyController', () => {
  it('serializes proxy changes so a slow earlier configuration cannot overwrite a newer one', async () => {
    const settings = new NetworkSettings()
    let finishInitialConfiguration!: () => void
    const initialConfiguration = new Promise<void>((resolve) => {
      finishInitialConfiguration = resolve
    })
    const setProxy = vi.fn().mockReturnValueOnce(initialConfiguration).mockResolvedValue(undefined)
    const closeAllConnections = vi.fn().mockResolvedValue(undefined)
    const controller = new NetworkProxyController({
      settings,
      electronSession: { setProxy, closeAllConnections },
      mobxUtils: { reaction },
      logger: { warn: vi.fn() }
    } as unknown as NetworkMainContext)

    controller.start()
    await vi.waitFor(() => expect(setProxy).toHaveBeenCalledTimes(1))
    runInAction(() => {
      settings.httpProxy = { strategy: 'fixed-servers', host: 'localhost', port: 1080 }
    })
    await Promise.resolve()
    expect(setProxy).toHaveBeenCalledTimes(1)

    finishInitialConfiguration()
    await controller.waitUntilConfigured()

    expect(setProxy).toHaveBeenNthCalledWith(2, {
      mode: 'fixed_servers',
      proxyRules: 'localhost:1080'
    })
    expect(closeAllConnections).toHaveBeenCalledOnce()
    controller.dispose()
  })
})
