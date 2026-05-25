import type { Database } from 'better-sqlite3'

export type AppDataDatabase = Pick<Database, 'exec' | 'prepare' | 'transaction'>
