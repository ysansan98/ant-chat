import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from './schema'

export type AppDataDatabase = BetterSQLite3Database<typeof schema>
