import { describe, expect, it, vi } from 'vitest'
import { ProfileIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  profileService: {
    readProfile: vi.fn(async () => ({
      profileRootPath: '/tmp/profile',
      userMarkdown: '§Use Chinese.',
      memoryMarkdown: '§Run pnpm check.',
      soulMarkdown: '# SOUL',
    })),
    updateProfile: vi.fn(async input => ({
      profileRootPath: '/tmp/profile',
      userMarkdown: input.userMarkdown ?? '§Use Chinese.',
      memoryMarkdown: input.memoryMarkdown ?? '§Run pnpm check.',
      soulMarkdown: input.soulMarkdown ?? '# SOUL',
    })),
    rollbackSoul: vi.fn(async () => ({
      profileRootPath: '/tmp/profile',
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

vi.mock('@main/adapters/appDataContainer', () => ({
  getAppDataServices: () => ({
    profileService: mocks.profileService,
  }),
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

describe('profile ipc', () => {
  it('reads profile files', async () => {
    const service = new ProfileIpcService()
    const response = await service.getProfile()

    expect(response.success).toBe(true)
    if (response.success) {
      expect(response.data.soulMarkdown).toBe('# SOUL')
    }
  })

  it('updates profile files', async () => {
    const service = new ProfileIpcService()
    const response = await service.updateProfile({
      userMarkdown: '§Use Chinese.',
      soulMarkdown: '# SOUL\n\n- Be direct.',
    })

    expect(response.success).toBe(true)
    expect(mocks.profileService.updateProfile).toHaveBeenCalledWith({
      userMarkdown: '§Use Chinese.',
      soulMarkdown: '# SOUL\n\n- Be direct.',
    })
  })

  it('rolls back SOUL.md', async () => {
    const service = new ProfileIpcService()
    const response = await service.rollbackSoul()

    expect(response.success).toBe(true)
    if (response.success) {
      expect(response.data.soulMarkdown).toBe('# SOUL rolled back')
    }
  })
})
