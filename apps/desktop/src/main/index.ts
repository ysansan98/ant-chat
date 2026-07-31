import process from 'node:process'
import { runControlCli } from '@ant-chat/control-client'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { app } from 'electron'
import { activateDesktopAppRuntime, disposeDesktopAppRuntime } from './app-runtime-host/appRuntime'
import { UpdateService } from './domains/update/updateService'
import { logger } from './utils/logger'
import { MainWindow } from './windows/window'
import './bridge'

const __dirname = process.cwd()

logger.info('Electron 主进程启动', __dirname)

const cliMarkerIndex = process.argv.indexOf('--ant-chat-cli')

if (cliMarkerIndex !== -1) {
  void runControlCli(process.argv.slice(cliMarkerIndex + 1), { appDataRoot: resolveAppDataRoot() }).then((result) => {
    if (result.output)
      process.stdout.write(`${result.output}\n`)
    if (result.error)
      process.stderr.write(`${result.error}\n`)
    app.exit(result.exitCode)
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    app.exit(1)
  })
}
else {
  void app.whenReady().then(async () => {
    await activateDesktopAppRuntime()

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
  }).catch((error) => {
    logger.error('AppRuntime 激活失败', error)
    app.exit(1)
  })

  let isRuntimeDisposed = false
  app.on('before-quit', (event) => {
    if (isRuntimeDisposed)
      return

    event.preventDefault()
    isRuntimeDisposed = true

    // 设置超时兜底，防止 disposeDesktopAppRuntime 永不 resolve 导致进程卡死
    const forceQuitTimeout = setTimeout(() => {
      logger.warn('disposeDesktopAppRuntime 超时，强制退出')
      app.exit(1)
    }, 5000)

    void disposeDesktopAppRuntime().finally(() => {
      clearTimeout(forceQuitTimeout)
      app.quit()
    })
  })

  // 处理进程信号：关闭终端时 shell 发送 SIGHUP，Electron 默认不响应，进程会变成孤儿
  const handleTerminationSignal = (signal: string) => {
    logger.info(`收到 ${signal} 信号，退出应用`)
    app.quit()
  }
  process.on('SIGHUP', handleTerminationSignal)
  process.on('SIGTERM', handleTerminationSignal)
  process.on('SIGINT', handleTerminationSignal)
}
