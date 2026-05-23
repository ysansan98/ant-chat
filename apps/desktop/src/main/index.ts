import process from 'node:process'
import { app } from 'electron'
import { initializeDb } from './db'
import { UpdateService } from './domains/update/updateService'
import { installDevTools } from './plugins/devtools'
import { skillFsService } from './skills/skillFsService'
import { WorkspaceStore } from './store/workspace'
import { isDev } from './utils/env'
import { logger } from './utils/logger'
import { initializeProxy } from './utils/proxy-manager'
import { MainWindow } from './window'
import './bridge'

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

  // 初始化默认工作区
  WorkspaceStore.getInstance().ensureInitialized()

  // 初始化本地 Skill 目录和内置 Skill
  await skillFsService.ensureInitialized()

  const mainWindow = new MainWindow()
  await mainWindow.createWindow()

  // 初始化更新服务
  const updateService = UpdateService.getInstance()
  updateService.initialize(mainWindow.getWindow()!)

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
