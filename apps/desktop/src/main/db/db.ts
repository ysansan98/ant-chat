import type { Database } from 'better-sqlite3'
import path from 'node:path'
import { initializeAppDataSchema } from '@ant-chat/app-data'
import _Database from 'better-sqlite3'
import { getAppDataRoot } from '../utils/appPaths'
import { DB_CONFIG } from '../utils/constants'
import { isDev } from '../utils/env'
import { logger } from '../utils/logger'
import { generateDbPath } from '../utils/util'
import { initializeData } from './initializeData'

const DB_PATH = path.join(getAppDataRoot(), isDev ? 'dev.db' : DB_CONFIG.dbFileName)

let sqlite: Database

export function getDb(): Database {
  if (!sqlite) {
    throw new Error('Database is not initialized')
  }
  return sqlite
}

export async function initializeDb() {
  logger.debug('DB_PATH => ', DB_PATH)
  generateDbPath(DB_PATH)

  try {
    sqlite = new _Database(DB_PATH, {
      timeout: DB_CONFIG.timeout,
    })
    initializeAppDataSchema(sqlite)
    logger.info('Database connected successfully.')
  }
  catch (e) {
    logger.error('Failed to initialize database:', (e as Error).message)
    process.exit(1)
  }

  logger.info('start initialize data')
  await initializeData()
}

export async function initializeTestDb() {
  logger.debug('Initializing test database (in-memory)...')

  try {
    sqlite = new _Database(':memory:', {
      timeout: DB_CONFIG.timeout,
    })
    initializeAppDataSchema(sqlite)
    logger.info('Test database connected successfully (in-memory).')
  }
  catch (e) {
    logger.error('Failed to initialize test database (in-memory):', (e as Error).message)
    process.exit(1)
  }
}
