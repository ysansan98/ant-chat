import process from 'node:process'
import { app } from 'electron'
import { UpdateService } from './domains/update/updateService'
import { installDevTools } from './plugins/devtools'
import { getAppRuntime } from './runtime/appRuntime'
import { isDev } from './utils/env'
import { logger } from './utils/logger'
import { MainWindow } from './windows/window'
import './bridge'

const __dirname = process.cwd()

logger.info('Electron 主进程启动', __dirname)

app.whenReady().then(async () => {
  // 安装开发工具扩展
  if (isDev) {
    installDevTools()
  }

  await getAppRuntime().initialize()

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

let isRuntimeDisposed = false
app.on('before-quit', (event) => {
  if (isRuntimeDisposed)
    return

  event.preventDefault()
  isRuntimeDisposed = true
  void getAppRuntime().dispose().finally(() => app.quit())
})
