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

      // dispose 完成后再次进入退出序列。Electron 在 quit 时会等待每个窗口的
      // renderer 完成关闭握手；Ctrl+C 等信号会先销毁 renderer 进程，握手
      // 永不完成导致 quit 挂起（进程存活、窗口已关）。Electron 不提供该握手
      // 的超时 API，这里用兜底定时器保证进程尽快退出——正常退出路径（Cmd+Q）
      // 的窗口握手在毫秒级完成并触发 will-quit 清除定时器，不会被误伤。
      const quitHangTimeout = setTimeout(() => {
        logger.warn('退出序列挂起，强制退出')
        app.exit(0)
      }, 1500)
      app.once('will-quit', () => clearTimeout(quitHangTimeout))
      app.quit()
    })
  })

  // 注意：不要在 Electron 主进程里依赖 process.on('SIGINT'/'SIGTERM'/'SIGHUP')。
  // Electron 40 实测这些 Node 信号处理器不会执行——Chromium 在浏览器进程层拦截
  // 信号并转换为应用退出序列（before-quit → 关窗 → will-quit → quit），
  // 因此信号触发的退出会自动走上面的 before-quit 流程。
}
