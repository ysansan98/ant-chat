import { createRequire } from 'node:module'
import { vi } from 'vitest'
import { initializeTestDb } from '../../db'

export async function mockDb() {
  vi.mock('../../../utils/util', () => ({
    getAppHand: vi.fn().mockReturnValue(''),
    getDirname: vi.fn().mockReturnValue(''),
  }))
  await initializeTestDb()
}

export function canRunDbIntegrationTests() {
  try {
    const require = createRequire(import.meta.url)
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.close()
    return true
  }
  catch {
    return false
  }
}
