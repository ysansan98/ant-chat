import { describe, expect, it, vi } from 'vitest'
import { MemoryIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  memory: {
    getFiles: vi.fn(async () => ({
      memoryRootPath: '/tmp/memory',
      userMarkdown: '§Use Chinese.',
      memoryMarkdown: '§Run pnpm check.',
      soulMarkdown: '# SOUL',
    })),
    updateFiles: vi.fn(async input => ({
      memoryRootPath: '/tmp/memory',
      userMarkdown: input.userMarkdown ?? '§Use Chinese.',
      memoryMarkdown: input.memoryMarkdown ?? '§Run pnpm check.',
      soulMarkdown: input.soulMarkdown ?? '# SOUL',
    })),
    rollbackSoul: vi.fn(async () => ({
      memoryRootPath: '/tmp/memory',
      userMarkdown: '§Use Chinese.',
      memoryMarkdown: '§Run pnpm check.',
      soulMarkdown: '# SOUL rolled back',
    })),
  },
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/runtime/appRuntime', () => ({
  getAppRuntime: () => ({
    memory: mocks.memory,
  }),
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

describe('memory ipc', () => {
  it('reads memory files', async () => {
    const service = new MemoryIpcService()
    const response = await service.getMemoryFiles()

    expect(response.success).toBe(true)
    if (response.success) {
      expect(response.data.soulMarkdown).toBe('# SOUL')
    }
  })

  it('updates memory files', async () => {
    const service = new MemoryIpcService()
    const response = await service.updateMemoryFiles({
      userMarkdown: '§Use Chinese.',
      soulMarkdown: '# SOUL\n\n- Be direct.',
    })

    expect(response.success).toBe(true)
    expect(mocks.memory.updateFiles).toHaveBeenCalledWith({
      userMarkdown: '§Use Chinese.',
      soulMarkdown: '# SOUL\n\n- Be direct.',
    })
  })

  it('rolls back SOUL.md', async () => {
    const service = new MemoryIpcService()
    const response = await service.rollbackSoul()

    expect(response.success).toBe(true)
    if (response.success) {
      expect(response.data.soulMarkdown).toBe('# SOUL rolled back')
    }
  })
})
