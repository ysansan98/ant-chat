import type { SystemLogger } from './systemLogger'
import path from 'node:path'
import process from 'node:process'
import { createAppRuntimePaths } from './paths'
import { createSystemLogger } from './systemLogger'

const loggers = new Map<string, SystemLogger>()

export interface AppRuntimeLoggerOptions {
  fileName?: string
  source?: string
}

export function getAppRuntimeLogger(appDataRoot: string, options: AppRuntimeLoggerOptions = {}): SystemLogger {
  const fileName = options.fileName ?? 'main.log'
  const source = options.source ?? 'app-runtime'
  const loggerKey = `${appDataRoot}:${fileName}:${source}`
  const existingLogger = loggers.get(loggerKey)
  if (existingLogger)
    return existingLogger

  const logger = createSystemLogger({
    console,
    filePath: path.join(createAppRuntimePaths(appDataRoot).logsRoot, fileName),
    source,
    writeDebugToConsole: process.env.NODE_ENV !== 'production',
  })
  loggers.set(loggerKey, logger)
  return logger
}
