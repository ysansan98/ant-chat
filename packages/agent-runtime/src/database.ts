import type { Database } from 'better-sqlite3'
import type BetterSqlite3Type from 'better-sqlite3'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export interface OpenAppDataDatabaseOptions {
  timeoutMs?: number
}

export function openAppDataDatabase(filePath: string, options: OpenAppDataDatabaseOptions = {}): Database {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const require = createRequire(import.meta.url)
  const BetterSqlite3 = require('better-sqlite3') as typeof BetterSqlite3Type

  return new BetterSqlite3(filePath, {
    timeout: options.timeoutMs ?? 30_000,
  })
}
