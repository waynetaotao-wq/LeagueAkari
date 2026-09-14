import { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AkariBaseWindowConfig, BaseAkariWindow } from './base-akari-window'

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

vi.mock('@main/i18n', () => ({
  i18next: { t: (key: string) => key }
}))

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  app: { getPath: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  shell: { openExternal: vi.fn() }
}))

vi.mock('./window-position-service', () => ({
  repositionWindowIfInvisible: vi.fn()
}))

function createContext() {
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }

  return {
    namespace: 'window-manager-main',
    loggerFactory: {
      create: vi.fn(() => logger)
    },
    settingFactory: {
      register: vi.fn(() => ({
        applyToState: vi.fn(),
        set: vi.fn(),
        _getFromStorage: vi.fn(),
        _saveToStorage: vi.fn()
      }))
    },
    appCommon: {},
    ipc: { onCall: vi.fn() },
    mobxUtils: { reaction: vi.fn(), propSync: vi.fn() },
    leagueClient: {},
    gameClient: {},
    windowManager: {},
    protocol: { registerPartition: vi.fn() },
    shared: { global: { platform: 'win32', isReadyToQuit: false } },
    keyboardShortcuts: {},
    logger
  }
}

class TestAkariWindow extends BaseAkariWindow<any, any> {
  constructor(
    context: ReturnType<typeof createContext>,
    stateShow: boolean,
    config: Partial<AkariBaseWindowConfig<any>> = {},
    suffix = 'test-window'
  ) {
    super(
      context as any,
      suffix,
      {
        status: 'normal',
        focus: 'blurred',
        ready: true,
        show: stateShow,
        trackedBounds: null
      },
      { pinned: false, opacity: 1 },
      {
        baseWidth: 320,
        baseHeight: 240,
        minWidth: 320,
        minHeight: 240,
        htmlEntry: 'test.html',
        ...config
      }
    )
  }

  attachWindow(window: Record<string, unknown>) {
    this._window = window as any
  }
}

function createNativeWindow(options: { visible: boolean; minimized?: boolean }) {
  let visible = options.visible
  return {
    isMinimized: vi.fn(() => options.minimized ?? false),
    isVisible: vi.fn(() => visible),
    show: vi.fn(() => {
      visible = true
    }),
    showInactive: vi.fn(() => {
      visible = true
    }),
    hide: vi.fn(() => {
      visible = false
    }),
    restore: vi.fn(),
    focus: vi.fn()
  }
}

describe('BaseAkariWindow visibility recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reissues show when public state is hidden but the native window reports visible', () => {
    const context = createContext()
    const akariWindow = new TestAkariWindow(context, false)
    const nativeWindow = createNativeWindow({ visible: true })
    akariWindow.attachWindow(nativeWindow)

    akariWindow.showOrRestore()

    expect(nativeWindow.show).toHaveBeenCalledOnce()
    expect(akariWindow.state.show).toBe(true)
    expect(context.logger.warn).toHaveBeenCalledOnce()
  })

  it('reissues show when public state is visible but the native window reports hidden', () => {
    const context = createContext()
    const akariWindow = new TestAkariWindow(context, true)
    const nativeWindow = createNativeWindow({ visible: false })
    akariWindow.attachWindow(nativeWindow)

    akariWindow.show()

    expect(nativeWindow.show).toHaveBeenCalledOnce()
    expect(akariWindow.state.show).toBe(true)
    expect(context.logger.warn).toHaveBeenCalledOnce()
  })

  it('only focuses a window when public and native visibility are both visible', () => {
    const context = createContext()
    const akariWindow = new TestAkariWindow(context, true)
    const nativeWindow = createNativeWindow({ visible: true })
    akariWindow.attachWindow(nativeWindow)

    akariWindow.showOrRestore()

    expect(nativeWindow.show).not.toHaveBeenCalled()
    expect(nativeWindow.focus).toHaveBeenCalledOnce()
    expect(context.logger.warn).not.toHaveBeenCalled()
  })

  it('synchronizes public state when hide finds the native window already hidden', () => {
    const context = createContext()
    const akariWindow = new TestAkariWindow(context, true)
    const nativeWindow = createNativeWindow({ visible: false })
    akariWindow.attachWindow(nativeWindow)

    akariWindow.hide()

    expect(nativeWindow.hide).not.toHaveBeenCalled()
    expect(akariWindow.state.show).toBe(false)
  })
})

class PersistentNativeWindow extends EventEmitter {
  visible: boolean
  maximized = false
  minimized = false
  destroyed = false
  bounds = { x: 30, y: 40, width: 500, height: 400 }
  webContents = Object.assign(new EventEmitter(), {
    session: new EventEmitter(),
    setWindowOpenHandler: vi.fn(),
    setZoomFactor: vi.fn()
  })
  constructor(private readonly options: Electron.BrowserWindowConstructorOptions) {
    super()
    this.visible = options.show ?? true
  }
  isDestroyed = () => this.destroyed
  isMaximized = () => this.maximized
  isMaximizable = () => this.options.maximizable !== false
  isMinimized = () => this.minimized
  isFullScreen = () => false
  isVisible = () => this.visible
  isFocused = () => false
  getContentBounds = () => this.bounds
  getNormalBounds = () => this.bounds
  setContentBounds = (bounds: typeof this.bounds) => {
    this.bounds = bounds
  }
  setContentProtection = vi.fn()
  setOpacity = vi.fn()
  setAlwaysOnTop = vi.fn()
  loadFile = vi.fn()
  focus = vi.fn()
  show = () => {
    this.visible = true
    this.emit('show')
  }
  showInactive = () => this.show()
  hide = () => {
    this.visible = false
    this.emit('hide')
  }
  maximize = vi.fn(() => {
    this.maximized = true
    this.emit('maximize')
    this.show()
  })
  unmaximize = () => {
    this.maximized = false
    this.emit('unmaximize')
  }
  destroy = () => {
    this.destroyed = true
    this.emit('closed')
  }
}

async function launchPersistentWindow(
  stored: Map<string, unknown>,
  config: Partial<AkariBaseWindowConfig<any>>,
  suffix = 'test-window'
) {
  vi.mocked(BrowserWindow).mockImplementation(function (options) {
    return new PersistentNativeWindow(options!) as any
  })
  const context = createContext()
  context.windowManager = { settings: { contentProtection: false } }
  const window = new TestAkariWindow(
    context,
    false,
    {
      rememberPosition: true,
      rememberSize: true,
      browserWindowOptions: { show: false, frame: false },
      ...config
    },
    suffix
  )
  window.state.ready = false
  const service = context.settingFactory.register.mock.results[0].value
  service._getFromStorage.mockImplementation(async (key: string) =>
    stored.get(`window-manager-main/${suffix}/${key}`)
  )
  service._saveToStorage.mockImplementation(async (key: string, value: unknown) => {
    stored.set(`window-manager-main/${suffix}/${key}`, value)
  })
  await window.onInit()
  window.createWindow()
  const nativeWindow = window.window as unknown as PersistentNativeWindow
  nativeWindow.emit('ready-to-show')
  return { window, nativeWindow, service }
}

describe('BaseAkariWindow optional maximized-state persistence', () => {
  const key = 'window-manager-main/test-window/maximized'

  it.each([undefined, false])(
    'does not restore or overwrite stored maximization when disabled (%s)',
    async (rememberMaximized) => {
      const stored = new Map<string, unknown>([[key, true]])
      const { window, nativeWindow } = await launchPersistentWindow(stored, { rememberMaximized })
      window.showOrRestore()
      expect(nativeWindow.maximize).not.toHaveBeenCalled()
      nativeWindow.maximize()
      nativeWindow.unmaximize()
      expect(stored.get(key)).toBe(true)
    }
  )

  it.each(['show', 'showOrRestore'] as const)(
    'keeps an opted-in window hidden until %s and restores only once',
    async (showMethod) => {
      const stored = new Map<string, unknown>([[key, true]])
      const { window, nativeWindow } = await launchPersistentWindow(stored, {
        rememberMaximized: true
      })
      expect(window.state.ready).toBe(true)
      expect(nativeWindow.isVisible()).toBe(false)
      expect(nativeWindow.maximize).not.toHaveBeenCalled()
      window[showMethod](true)
      expect(nativeWindow.maximize).toHaveBeenCalledOnce()
      expect(nativeWindow.focus).not.toHaveBeenCalled()
      expect(window.state.status).toBe('maximized')
      nativeWindow.unmaximize()
      window.hide()
      window[showMethod]()
      expect(nativeWindow.maximize).toHaveBeenCalledOnce()
      expect(stored.get(key)).toBe(false)
    }
  )

  it('reads and writes each window namespace independently, including after recreation', async () => {
    const stored = new Map<string, unknown>([[key, true]])
    const { window, nativeWindow } = await launchPersistentWindow(
      stored,
      { rememberMaximized: true },
      'second-window'
    )
    window.showOrRestore()
    expect(nativeWindow.maximize).not.toHaveBeenCalled()
    nativeWindow.maximize()
    expect(stored.get('window-manager-main/second-window/maximized')).toBe(true)
    nativeWindow.destroy()
    window.createWindow()
    const replacement = window.window as unknown as PersistentNativeWindow
    replacement.emit('ready-to-show')
    expect(replacement.isVisible()).toBe(false)
    window.showOrRestore()
    expect(replacement.isMaximized()).toBe(true)
    replacement.unmaximize()
    expect(stored.get('window-manager-main/second-window/maximized')).toBe(false)
    expect(stored.get(key)).toBe(true)
  })

  it('does not maximize a non-maximizable window even with a saved preference', async () => {
    const { window, nativeWindow } = await launchPersistentWindow(new Map([[key, true]]), {
      rememberMaximized: true,
      browserWindowOptions: { show: false, maximizable: false }
    })
    window.showOrRestore()
    expect(nativeWindow.isVisible()).toBe(true)
    expect(nativeWindow.maximize).not.toHaveBeenCalled()
  })

  it('focuses a restored window when show is explicitly active', async () => {
    const { window, nativeWindow } = await launchPersistentWindow(new Map([[key, true]]), {
      rememberMaximized: true
    })
    window.show()
    expect(nativeWindow.isMaximized()).toBe(true)
    expect(nativeWindow.focus).toHaveBeenCalledOnce()
  })

  it('also restores a hidden window opened through its minimize/focus shortcut', async () => {
    const { window, nativeWindow } = await launchPersistentWindow(new Map([[key, true]]), {
      rememberMaximized: true
    })
    window.toggleMinimizedAndFocused()
    expect(nativeWindow.isMaximized()).toBe(true)
    expect(nativeWindow.focus).toHaveBeenCalledOnce()
  })

  it('restores an opted-in window created with show:true after recovering normal bounds', async () => {
    const bounds = { x: 50, y: 70, width: 800, height: 600 }
    const stored = new Map<string, unknown>([
      [key, true],
      ['window-manager-main/test-window/trackedBounds', bounds]
    ])
    const { nativeWindow } = await launchPersistentWindow(stored, {
      rememberMaximized: true,
      browserWindowOptions: { show: true }
    })
    expect(nativeWindow.isMaximized()).toBe(true)
    expect(nativeWindow.getNormalBounds()).toEqual(bounds)
  })
})
