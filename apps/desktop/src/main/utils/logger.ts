import { createSystemLogger } from '@ant-chat/agent-runtime'
import { isDev } from './env'
import { LogPathManager } from './logPathManager'

const logPathManager = LogPathManager.getInstance()

export const originalConsole = {
  debug: console.debug,
  error: console.error,
  info: console.info,
  log: console.log,
  trace: console.trace,
  warn: console.warn,
}

const logger = createSystemLogger({
  console: originalConsole,
  filePath: logPathManager.getSystemLogPath(),
  source: 'desktop-main',
  writeDebugToConsole: isDev,
})

logger.info('log path:', logPathManager.getSystemLogPath())

export {
  logger,
}
