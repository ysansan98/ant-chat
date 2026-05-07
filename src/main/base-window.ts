import { join } from 'node:path'
import process from 'node:process'
import { BrowserWindow, shell } from 'electron'
import { isDev, isMacOS, isWindows } from './utils/env'
import { logger } from './utils/logger'

export interface BaseWindowOptions {
  width: number
  height: number
  hash?: string
  enableDevMenu?: boolean
}

export abstract class BaseWindow {
  protected window: BrowserWindow | null = null
  private readonly options: BaseWindowOptions
  private static preloadPath: string | null = null

  constructor(options: BaseWindowOptions) {
    this.options = options
    if (!BaseWindow.preloadPath) {
      BaseWindow.preloadPath = join(__dirname, '../preload/index.js')
    }
  }

  abstract onWindowCreated?(window: BrowserWindow): void

  async createWindow() {
    // 如果窗口已存在，聚焦它
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) {
        this.window.restore()
      }
      this.window.focus()
      return
    }

    const preload = BaseWindow.preloadPath!
    logger.debug('preload path => ', preload)

    this.window = new BrowserWindow({
      width: this.options.width,
      height: this.options.height,
      frame: !(isWindows),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        preload,
      },
      titleBarStyle: isMacOS ? 'hidden' : 'default',
      trafficLightPosition: { x: 19, y: 19 },
    })

    this.setupWindow(this.window)

    // 加载页面
    if (isDev && process.env.ELECTRON_RENDERER_URL) {
      const url = process.env.ELECTRON_RENDERER_URL + (this.options.hash ? `#${this.options.hash}` : '')
      logger.debug('Loading dev server => ', url)
      this.window.loadURL(url).catch((err) => {
        logger.error('Failed to load dev server:', err)
        logger.info('Please make sure the web project is running (pnpm dev)')
      })
    } else {
      const webDistPath = join(__dirname, '../renderer/index.html')
      logger.info('生产环境加载文件', webDistPath)
      if (this.options.hash) {
        this.window.loadFile(webDistPath, { hash: this.options.hash })
      } else {
        this.window.loadFile(webDistPath)
      }
    }

    // 子类可以重写这个方法来添加额外的初始化
    if (this.onWindowCreated) {
      this.onWindowCreated(this.window)
    }
  }

  private setupWindow(window: BrowserWindow) {
    // 开发模式下添加快捷键支持
    if (isDev) {
      this.setupDevShortcuts(window)
    }

    this.setupNavigationHandlers(window)

    window.on('closed', () => {
      this.window = null
      this.onWindowClosed()
    })
  }

  protected onWindowClosed() {
    // 子类可以重写这个方法来处理窗口关闭时的清理工作
  }

  private setupDevShortcuts(window: BrowserWindow) {
    window.webContents.on('before-input-event', (event, input) => {
      // Command+Option+I (Mac) 或 Ctrl+Shift+I (Windows/Linux)
      if (input.key === 'i' && input.control && input.shift) {
        window.webContents.toggleDevTools()
        event.preventDefault()
      }
      // 刷新页面: Command+R (Mac) 或 Ctrl+R (Windows/Linux)
      if (input.key === 'r' && (input.control || input.meta)) {
        window.webContents.reload()
        event.preventDefault()
      }
    })
  }

  private setupNavigationHandlers(window: BrowserWindow) {
    window.webContents.on('will-navigate', (event, url) => {
      logger.debug('will-navigate', url)

      if (isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL || '')) {
        return
      }
      const isExternal = url.startsWith('http:') || url.startsWith('https:')
      if (isExternal) {
        event.preventDefault()
        shell.openExternal(url)
      }
    })

    window.webContents.setWindowOpenHandler(({ url }) => {
      logger.debug('setWindowOpenHandler', url)
      const isExternal = url.startsWith('http:') || url.startsWith('https:')
      if (isExternal) {
        shell.openExternal(url)
        return { action: 'deny' }
      }
      return { action: 'allow' }
    })
  }

  getWindow() {
    return this.window
  }

  isWindowOpen() {
    return this.window && !this.window.isDestroyed()
  }
}
