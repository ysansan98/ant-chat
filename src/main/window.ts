import { join } from 'node:path'
import process from 'node:process'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { isDev, isMacOS, isWindows } from './utils/env'
import { logger } from './utils/logger'

// const __dirname = process.cwd()

let mainWindow: null | BrowserWindow = null

export class MainWindow {
  private window: BrowserWindow | null = null

  private createMenu() {
    const template = [
      // macOS 应用菜单
      ...(isMacOS
        ? [{
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          }]
        : []),
      // 编辑菜单
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          ...(isMacOS
            ? [
                { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
                { role: 'delete', label: '删除' },
                { role: 'selectAll', label: '全选' },
              ]
            : [
                { role: 'delete', label: '删除' },
                { type: 'separator' },
                { role: 'selectAll', label: '全选' },
              ]),
        ],
      },
      ...(isDev
        ? [
            // 视图菜单
            {
              label: '视图',
              submenu: [
                { role: 'reload', label: '重新加载' },
                { role: 'forceReload', label: '强制重新加载' },
                { role: 'toggleDevTools', label: '开发者工具' },
                { type: 'separator' },
                { role: 'resetZoom', label: '重置缩放' },
                { role: 'zoomIn', label: '放大' },
                { role: 'zoomOut', label: '缩小' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: '全屏' },
              ],
            },
          ]
        : []),
    ]

    const menu = Menu.buildFromTemplate(template as any)
    Menu.setApplicationMenu(menu)
  }

  async createWindow() {
    const preload = join(__dirname, '../preload/index.js')

    logger.debug('preload path => ', preload)

    this.window = new BrowserWindow({
      width: 1200,
      height: 900,
      frame: !(isWindows),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        preload,
      },
      titleBarStyle: isMacOS ? 'hidden' : 'default',
    })

    mainWindow = this.window

    // 创建菜单
    this.createMenu()

    // 开发模式下加载本地服务器
    if (isDev && process.env.ELECTRON_RENDERER_URL) {
      logger.debug('Loading dev server => ', process.env.ELECTRON_RENDERER_URL)
      this.window.loadURL(process.env.ELECTRON_RENDERER_URL).catch((err) => {
        logger.error('Failed to load dev server:', err)
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

        // 退出应用: Command+Q (Mac) 或 Ctrl+Q (Windows/Linux)
        if (input.key === 'q' && (input.control || input.meta)) {
          app.quit()
          event.preventDefault()
        }
      })

      // 监听页面加载状态
      this.window.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
        logger.error('Page failed to load:', errorCode, errorDescription)
      })

      this.window.webContents.on('did-finish-load', () => {
        logger.info('页面加载成功')
      })
    }
    else {
      // 生产环境加载打包后的文件
      const webDistPath = join(__dirname, '../renderer/index.html')
      logger.info('生产环境加载打包后的文件', webDistPath)
      this.window.loadFile(webDistPath)
    }

    this.window.webContents.on('will-navigate', (event, url) => {
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

    this.window.on('closed', () => {
      this.window = null
    })
  }

  getWindow() {
    // logger.info('获取窗口', this.window)
    return this.window
  }
}

export function getMainWindow(): typeof mainWindow {
  if (mainWindow) {
    return mainWindow
  }

  throw new Error('Main window is not created yet')
}
