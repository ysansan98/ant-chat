import { vi } from 'vitest'
import { initializeTestDb } from '../../db'

export async function mockDb() {
  vi.mock('../../../utils/util', () => ({
    getAppHand: vi.fn().mockReturnValue(''),
    getDirname: vi.fn().mockReturnValue(''),
  }))
  await initializeTestDb()
}
