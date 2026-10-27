import type { UpdateConfig } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateIpcService } from '../ipc'

const validConfig: UpdateConfig = {
  autoCheck: true,
  autoDownload: false,
  checkInterval: 'daily',
  includePrerelease: false,
  lastCheckTime: 100,
}

const mocks = vi.hoisted(() => ({
  updateConfig: vi.fn((config: UpdateConfig) => config),
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/domains/update/updateService', () => ({
  UpdateService: {
    getInstance: () => ({
      updateConfig: mocks.updateConfig,
    }),
  },
}))

vi.mock('@main/store/updateSettings', () => ({
  UpdateConfigStore: {
    getInstance: () => ({
      getConfig: vi.fn(),
    }),
  },
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))

describe('update ipc', () => {
  beforeEach(() => {
    mocks.updateConfig.mockClear()
  })

  it('合法配置保持原有保存行为', async () => {
    const service = new UpdateIpcService()
    const response = await service.setUpdateConfig(validConfig)

    expect(response.success).toBe(true)
    if (response.success) {
      expect(response.data).toEqual(validConfig)
    }
    expect(mocks.updateConfig).toHaveBeenCalledWith(validConfig)
  })

  it('拒绝非对象配置，且不调用 updateService', async () => {
    const service = new UpdateIpcService()

    for (const config of [null, [], 'config', 1]) {
      const response = await service.setUpdateConfig(config as never)
      expect(response.success).toBe(false)
      if (!response.success) {
        expect(response.msg).toBe('setUpdateConfig 的 config 必须是对象')
      }
    }
    expect(mocks.updateConfig).not.toHaveBeenCalled()
  })

  it('拒绝未知字段和非法字段值，且不调用 updateService', async () => {
    const service = new UpdateIpcService()
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...validConfig, exec: 'rm' }, 'setUpdateConfig 的 config 包含未知字段: exec'],
      [{ ...validConfig, autoCheck: 'yes' }, 'setUpdateConfig 的 config.autoCheck 必须是布尔值'],
      [{ ...validConfig, checkInterval: 'hourly' }, 'setUpdateConfig 的 config.checkInterval 必须是 startup、daily 或 weekly'],
      [{ ...validConfig, lastCheckTime: -1 }, 'setUpdateConfig 的 config.lastCheckTime 必须是非负有限数字'],
      [{ ...validConfig, skippedVersion: 1 }, 'setUpdateConfig 的 config.skippedVersion 必须是字符串'],
    ]

    for (const [config, message] of cases) {
      const response = await service.setUpdateConfig(config as never)
      expect(response.success).toBe(false)
      if (!response.success) {
        expect(response.msg).toBe(message)
      }
    }
    expect(mocks.updateConfig).not.toHaveBeenCalled()
  })

  it('缺少必填字段时拒绝', async () => {
    const service = new UpdateIpcService()
    const response = await service.setUpdateConfig({ autoCheck: true } as never)

    expect(response.success).toBe(false)
    expect(mocks.updateConfig).not.toHaveBeenCalled()
  })
})
