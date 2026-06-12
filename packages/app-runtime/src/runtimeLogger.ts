import type { SystemLogger } from '@ant-chat/agent-runtime'
import path from 'node:path'
import process from 'node:process'
import { createSystemLogger } from '@ant-chat/agent-runtime'
import { createAppRuntimePaths } from './paths'

const loggers = new Map<string, SystemLogger>()

export function getAppRuntimeLogger(appDataRoot: string): SystemLogger {
  const existingLogger = loggers.get(appDataRoot)
  if (existingLogger)
    return existingLogger

  const logger = createSystemLogger({
    console,
    filePath: path.join(createAppRuntimePaths(appDataRoot).logsRoot, 'main.log'),
    source: 'app-runtime',
    writeDebugToConsole: process.env.NODE_ENV !== 'production',
  })
  loggers.set(appDataRoot, logger)
  return logger
}
