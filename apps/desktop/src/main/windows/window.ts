import type { BrowserWindow } from 'electron'
import { app, Menu } from 'electron'
import { isDev, isMacOS } from '../utils/env'
import { sendToRenderer } from '../utils/ipc-events'
import { logger } from '../utils/logger'
import { BaseWindow } from './base-window'

let mainWindow: null | BrowserWindow = null

export class MainWindow extends BaseWindow {
  constructor() {
    super({ type: 'main', width: 1200, height: 900 })
  }

  override async createWindow() {
    await super.createWindow()
    if (this.window) {
      mainWindow = this.window
    }
  }

  protected onWindowCreated(window: BrowserWindow) {
    // 创建菜单
    this.createMenu()

    // 开发模式下添加额外的事件监听
    if (isDev) {
      this.setupDevEvents(window)
    }
  }

  protected override onWindowClosed() {
    mainWindow = null
  }

  private createMenu() {
    // 生产环境 Windows/Linux：不显示原生菜单栏；复制/粘贴等编辑快捷键由渲染层内置，不受影响。
    // macOS 仍需保留应用菜单（Cmd+C/V 等依赖 role 加速器）。
    if (!isDev && !isMacOS) {
      Menu.setApplicationMenu(null)
      return
    }
    const template = [
      // macOS 应用菜单
      ...(isMacOS
        ? [{
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Settings...',
                accelerator: 'Command+,',
                click: () => {
                  // 设置页已合并进主窗口路由，菜单仅通知渲染进程在窗口内跳转
                  if (this.window) {
                    sendToRenderer(this.window.webContents, 'app:navigate', '/settings')
                  }
                },
              },
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

  private setupDevEvents(window: BrowserWindow) {
    window.webContents.on('before-input-event', (event, input) => {
      // 退出应用: Command+Q (Mac) 或 Ctrl+Q (Windows/Linux)
      if (input.key === 'q' && (input.control || input.meta)) {
        app.quit()
        event.preventDefault()
      }
    })

    window.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
      logger.error('Page failed to load:', errorCode, errorDescription)
    })

    window.webContents.on('did-finish-load', () => {
      logger.info('页面加载成功')
    })
  }
}

export function getMainWindow(): typeof mainWindow {
  if (mainWindow) {
    return mainWindow
  }

  throw new Error('Main window is not created yet')
}
