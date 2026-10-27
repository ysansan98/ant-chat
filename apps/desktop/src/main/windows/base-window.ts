import { join } from 'node:path'
import process from 'node:process'
import { BrowserWindow, shell } from 'electron'
import { isDev, isMacOS } from '../utils/env'
import { logger } from '../utils/logger'
import { setupNavigationHandlers } from './navigation-handlers'

/** 生产环境渲染层入口；加载与导航白名单共用，避免两处路径漂移 */
const APP_INDEX_PATH = join(__dirname, '../renderer/index.html')

export interface BaseWindowOptions {
  type: 'main'
  width: number
  height: number
  hash?: string
  enableDevMenu?: boolean
}

export abstract class BaseWindow {
  protected window: BrowserWindow | null = null
  private readonly options: BaseWindowOptions
  private static preloadPath: string | null = null
  /** 首次页面加载的开始时间戳；记录首次加载耗时后置 0 */
  private firstLoadStartedAt = 0

  constructor(options: BaseWindowOptions) {
    this.options = options
    if (!BaseWindow.preloadPath) {
      BaseWindow.preloadPath = join(__dirname, '../preload/index.js')
    }
  }

  protected onWindowCreated(_window: BrowserWindow) {}

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

    this.firstLoadStartedAt = Date.now()
    this.window = new BrowserWindow({
      width: this.options.width,
      height: this.options.height,
      frame: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        // Electron 20+ 默认即沙箱；显式声明防止后续改动意外关闭
        sandbox: true,
        preload,
      },
      titleBarStyle: isMacOS ? 'hidden' : 'default',
      trafficLightPosition: { x: 19, y: 12 },
    })

    this.setupWindow(this.window)

    if (isDev && process.env.ELECTRON_RENDERER_URL) {
      const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL)
      if (this.options.hash) {
        rendererUrl.hash = this.options.hash
      }

      logger.debug('Loading dev server => ', rendererUrl.toString())
      this.window.loadURL(rendererUrl.toString()).catch((err) => {
        logger.error('Failed to load dev server:', err)
        logger.info('Please make sure the web project is running (pnpm dev)')
      })
    }
    else {
      logger.info('生产环境加载文件', APP_INDEX_PATH)
      this.window.loadFile(APP_INDEX_PATH, {
        hash: this.options.hash,
      })
    }

    // 子类可以重写这个方法来添加额外的初始化
    this.onWindowCreated(this.window)
  }

  private setupWindow(window: BrowserWindow) {
    // 开发模式下添加快捷键支持
    if (isDev) {
      this.setupDevShortcuts(window)
    }

    this.installNavigationHandlers(window)

    // 首次加载耗时统计：did-finish-load 在首次加载完成时触发一次
    // （含加载失败后错误页完成的情况），刷新页面不会重复统计
    window.webContents.on('did-finish-load', () => {
      if (this.firstLoadStartedAt === 0)
        return
      const duration = Date.now() - this.firstLoadStartedAt
      this.firstLoadStartedAt = 0
      logger.info(`窗口 ${this.options.type} 首次加载完成，耗时 ${duration}ms`)
    })

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
      // 带 Shift 时 input.key 为大写（Ctrl+Shift+I → 'I'），统一转小写匹配
      // Command+Option+I (Mac) 或 Ctrl+Shift+I (Windows/Linux)
      if (input.key.toLowerCase() === 'i' && input.control && input.shift) {
        window.webContents.toggleDevTools()
        event.preventDefault()
      }
      // 刷新页面: Command+R (Mac) 或 Ctrl+R (Windows/Linux)
      if (input.key.toLowerCase() === 'r' && (input.control || input.meta)) {
        window.webContents.reload()
        event.preventDefault()
      }
    })
  }

  private installNavigationHandlers(window: BrowserWindow) {
    setupNavigationHandlers(window.webContents, {
      context: {
        isDev,
        rendererUrl: process.env.ELECTRON_RENDERER_URL,
        appIndexPath: APP_INDEX_PATH,
      },
      openExternal: url => shell.openExternal(url),
      onExternalOpenError: error => logger.error('打开外部链接失败', error),
      log: (message, ...args) => logger.debug(message, ...args),
    })
  }

  getWindow() {
    return this.window
  }

  isWindowOpen() {
    return this.window && !this.window.isDestroyed()
  }
}
