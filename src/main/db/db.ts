import type { Database } from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import path from 'node:path'
import _Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { APP_NAME, DB_CONFIG } from '../utils/constants'
import { isDev } from '../utils/env'
import { logger } from '../utils/logger'
import { generateDbPath, getAppHand, getDirname } from '../utils/util'
import { initializeData } from './initializeData'
import * as schema from './schema'

const __dirname = getDirname(import.meta.url)
const projectPath = process.cwd()
const DB_PATH = isDev
  ? path.join(projectPath, 'dev.db')
  : path.join(getAppHand(), APP_NAME, DB_CONFIG.dbFileName)

// eslint-disable-next-line import/no-mutable-exports
export let db: BetterSQLite3Database<typeof schema>

/**
 * 连接数据库
 */
export async function initializeDb() {
  logger.debug('DB_PATH => ', DB_PATH)
  let sqlite: Database | null = null

  generateDbPath(DB_PATH)

  try {
    sqlite = new _Database(DB_PATH, {
      timeout: DB_CONFIG.timeout,
    })
    logger.info('Database connected successfully.')
  }
  catch (e) {
    logger.error('Failed to connect to the database:', (e as Error).message)
    process.exit(1)
  }

  if (!sqlite) {
    logger.error('Database connection is null after initialization attempt.')
    process.exit(1)
  }

  db = drizzle(sqlite as Database, { schema, logger: false })
  const migrationsFolder = path.join(__dirname, '../../migrations')
  logger.debug('migrationsFolder => ', migrationsFolder)
  try {
    migrate(db, { migrationsFolder })
    logger.info('Database migrations applied successfully.')
  }
  catch (e) {
    logger.error('Failed to apply database migrations:', (e as Error).message)
    process.exit(1)
  }

  logger.info('start initialize data')
  await initializeData()
}

/**
 * 连接测试数据库（内存数据库）
 */
export async function initializeTestDb() {
  logger.debug('Initializing test database (in-memory)...')
  let sqlite: Database | null = null

  try {
    // 使用内存数据库
    sqlite = new _Database(':memory:', {
      timeout: DB_CONFIG.timeout,
    })
    logger.info('Test database connected successfully (in-memory).')
  }
  catch (e) {
    logger.error('Failed to connect to the test database (in-memory):', (e as Error).message)
    // 在测试环境中，失败通常意味着需要终止
    process.exit(1)
  }

  if (!sqlite) {
    logger.error('Test database connection is null after initialization attempt (in-memory).')
    process.exit(1)
  }

  db = drizzle(sqlite as Database, { schema })
  const migrationsFolder = path.join(projectPath, './migrations')
  logger.debug('migrationsFolder for test db => ', migrationsFolder)
  try {
    migrate(db, { migrationsFolder })
    logger.info('Test database migrations applied successfully (in-memory).')
  }
  catch (e) {
    logger.error('Failed to apply test database migrations (in-memory):', (e as Error).message)
    process.exit(1)
  }
}
