import type { ILogger } from '@ant-chat/shared'
import fs from 'node:fs'
import path from 'node:path'

export type SystemLogLevel = 'debug' | 'error' | 'info' | 'warn'

export interface SystemLogger extends ILogger {
  debug: (msg: string, ...args: unknown[]) => void
}

export interface SystemLoggerConsole {
  debug: (message?: unknown, ...args: unknown[]) => void
  error: (message?: unknown, ...args: unknown[]) => void
  info: (message?: unknown, ...args: unknown[]) => void
  warn: (message?: unknown, ...args: unknown[]) => void
}

export interface CreateSystemLoggerOptions {
  filePath: string
  console: SystemLoggerConsole
  source?: string
  maxFileSize?: number
  writeDebugToConsole?: boolean
}

const defaultMaxFileSize = 1024 * 1024 * 5

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatLogArg(arg: unknown): string {
  if (typeof arg === 'string')
    return arg

  if (arg instanceof Error)
    return arg.stack ?? arg.message

  if (typeof arg === 'undefined')
    return 'undefined'

  if (arg === null)
    return 'null'

  if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint')
    return String(arg)

  try {
    return summarizeValue(arg)
  }
  catch {
    return String(arg)
  }
}

function summarizeRecord(record: Record<string, unknown>): string {
  return Object.entries(record)
    .slice(0, 8)
    .map(([key, value]) => `${key}=${formatLogArg(value)}`)
    .join(' ')
}

function summarizeValue(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.length} items]`

  if (value && typeof value === 'object')
    return summarizeRecord(value as Record<string, unknown>)

  return JSON.stringify(value)
}

function formatMessage(level: SystemLogLevel, source: string | undefined, args: unknown[]): string {
  const sourcePrefix = source ? ` ${source}` : ''
  return `${formatDate(new Date())} [${level}]${sourcePrefix} ${args.map(formatLogArg).join(' ')}`
}

function ensureLogDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function rotateLogFile(filePath: string, maxFileSize: number): void {
  if (!fs.existsSync(filePath))
    return

  const stat = fs.statSync(filePath)
  if (stat.size < maxFileSize)
    return

  const rotatedPath = `${filePath}.1`
  if (fs.existsSync(rotatedPath))
    fs.rmSync(rotatedPath)
  fs.renameSync(filePath, rotatedPath)
}

function writeFileLog(filePath: string, maxFileSize: number, level: SystemLogLevel, args: unknown[]): void {
  ensureLogDir(filePath)
  rotateLogFile(filePath, maxFileSize)
  fs.appendFileSync(filePath, `${formatMessage(level, undefined, args)}\n`, 'utf8')
}

function writeConsoleLog(options: CreateSystemLoggerOptions, level: SystemLogLevel, args: unknown[]): void {
  if (level === 'debug' && !options.writeDebugToConsole)
    return

  const consoleMessage = formatMessage(level, options.source, args)
  if (level === 'error') {
    options.console.error(consoleMessage)
    return
  }
  if (level === 'warn') {
    options.console.warn(consoleMessage)
    return
  }
  if (level === 'debug') {
    options.console.debug(consoleMessage)
    return
  }
  options.console.info(consoleMessage)
}

export function createSystemLogger(options: CreateSystemLoggerOptions): SystemLogger {
  const maxFileSize = options.maxFileSize ?? defaultMaxFileSize

  function write(level: SystemLogLevel, args: unknown[]): void {
    try {
      writeFileLog(options.filePath, maxFileSize, level, options.source ? [options.source, ...args] : args)
    }
    catch (error) {
      options.console.error('[logger] failed to write log file', error)
    }
    writeConsoleLog(options, level, args)
  }

  return {
    debug: (msg, ...args) => write('debug', [msg, ...args]),
    error: (msg, ...args) => write('error', [msg, ...args]),
    info: (msg, ...args) => write('info', [msg, ...args]),
    warn: (msg, ...args) => write('warn', [msg, ...args]),
  }
}
