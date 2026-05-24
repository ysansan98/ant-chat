import log from 'electron-log'
import { isDev } from './env'
import { LogPathManager } from './logPathManager'

const logPathManager = LogPathManager.getInstance()

log.transports.file.maxSize = 1024 * 1024 * 5 // 5MB

log.transports.file.level = 'debug'
log.transports.console.level = 'info'

// 动态路径：每次写入时通过 LogPathManager 解析，支持运行时切换
log.transports.file.resolvePathFn = () => logPathManager.getSystemLogPath()
log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s} [{level}] {text}'

log.transports.console.format = '[{level}] {text}' // 控制台简洁格式

log.info('log path: ', logPathManager.getSystemLogPath())

const loggingEnabled = true

const logger = log

function hookConsole() {
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
    trace: console.trace,
  }

  // 替换console方法
  console.log = (...args: unknown[]) => {
    // 只有在启用日志或开发模式下才记录日志
    if (loggingEnabled || isDev) {
      logger.info(...args)
    }
  }

  console.error = (...args: unknown[]) => {
    // 只有在启用日志或开发模式下才记录日志
    if (loggingEnabled || isDev) {
      logger.error(...args)
    }
  }

  console.warn = (...args: unknown[]) => {
    // 只有在启用日志或开发模式下才记录日志
    if (loggingEnabled || isDev) {
      logger.warn(...args)
    }
  }

  console.info = (...args: unknown[]) => {
    // 只有在启用日志或开发模式下才记录日志
    if (loggingEnabled || isDev) {
      logger.info(...args)
    }
  }

  console.debug = (...args: unknown[]) => {
    // 只有在启用日志或开发模式下才记录日志
    if (loggingEnabled || isDev) {
      logger.debug(...args)
    }
  }

  console.trace = (...args: unknown[]) => {
    // 只有在启用日志或开发模式下才记录日志
    if (loggingEnabled || isDev) {
      logger.debug(...args)
    }
  }

  return originalConsole
}

// 导出原始console方法，以便需要时可以恢复
export const originalConsole = hookConsole()

export {
  logger,
}
