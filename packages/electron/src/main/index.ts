import process from 'node:process'
import { app } from 'electron'
import { initializeDb } from './db'
import { registerIpcEvents } from './ipcHandlers'
import { registerMcpHandlers } from './ipcHandlers/mcpHandlers'
import { clientHub } from './mcpClientHub'
import { installDevTools } from './plugins/devtools'
import { UpdateService } from './services'
import { isDev } from './utils/env'
import { logger } from './utils/logger'
import { initializeProxy } from './utils/proxy-manager'
import { MainWindow } from './window'

const __dirname = process.cwd()

logger.info('Electron 主进程启动', __dirname)

app.whenReady().then(async () => {
  // 安装开发工具扩展
  if (isDev) {
    installDevTools()
  }

  // 初始化数据库
  await initializeDb()

  // 初始化代理设置
  await initializeProxy()

  const mainWindow = new MainWindow()
  await mainWindow.createWindow()
  registerIpcEvents(mainWindow.getWindow()!)

  // 初始化更新服务
  const updateService = UpdateService.getInstance()
  updateService.initialize(mainWindow.getWindow()!)

  // 初始化 MCP 服务
  registerMcpHandlers(clientHub)

  app.on('activate', () => {
    if (!mainWindow.getWindow()) {
      mainWindow.createWindow()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
      app.quit()
  })
})
