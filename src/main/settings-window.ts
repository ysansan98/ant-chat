import { join } from 'node:path'
import process from 'node:process'
import { BrowserWindow, shell } from 'electron'
import { isDev, isMacOS, isWindows } from './utils/env'
import { logger } from './utils/logger'

let settingsWindow: null | BrowserWindow = null

export class SettingsWindow {
  private window: BrowserWindow | null = null

  async createWindow() {
    // 如果窗口已存在，聚焦它
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) {
        this.window.restore()
      }
      this.window.focus()
      return
    }

    const preload = join(__dirname, '../preload/index.js')

    logger.debug('settings window preload path => ', preload)

    this.window = new BrowserWindow({
      width: 900,
      height: 700,
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

    settingsWindow = this.window

    // 开发模式下加载本地服务器
    if (isDev && process.env.ELECTRON_RENDERER_URL) {
      logger.debug('Loading settings dev server => ', process.env.ELECTRON_RENDERER_URL + '#/settings')
      this.window.loadURL(process.env.ELECTRON_RENDERER_URL + '#/settings').catch((err) => {
        logger.error('Failed to load settings dev server:', err)
        logger.info('Please make sure the web project is running (pnpm dev)')
      })

      // 添加快捷键支持
      this.window.webContents.on('before-input-event', (event, input) => {
        // Command+Option+I (Mac) 或 Ctrl+Shift+I (Windows/Linux)
        if (input.key === 'i' && input.control && input.shift) {
          this.window?.webContents.toggleDevTools()
          event.preventDefault()
        }
        // 刷新页面: Command+R (Mac) 或 Ctrl+R (Windows/Linux)
        if (input.key === 'r' && (input.control || input.meta)) {
          this.window?.webContents.reload()
          event.preventDefault()
        }
      })
    }
    else {
      // 生产环境加载打包后的文件
      const webDistPath = join(__dirname, '../renderer/index.html')
      logger.info('生产环境加载设置窗口文件', webDistPath)
      this.window.loadFile(webDistPath, {
        hash: '#/settings',
      })
    }

    this.window.webContents.on('will-navigate', (event, url) => {
      logger.debug('settings window will-navigate', url)

      if (isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL || '')) {
        return
      }
      const isExternal = url.startsWith('http:') || url.startsWith('https:')
      if (isExternal) {
        event.preventDefault()
        shell.openExternal(url)
      }
    })

    this.window.on('closed', () => {
      this.window = null
      settingsWindow = null
    })
  }

  getWindow() {
    return this.window
  }
}

export function getSettingsWindow(): typeof settingsWindow {
  return settingsWindow
}
