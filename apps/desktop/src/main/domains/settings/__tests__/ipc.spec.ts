import { describe, expect, it, vi } from 'vitest'
import { SettingsIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  openSettingsWindow: vi.fn(async () => {}),
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/windows/settings-window', () => ({
  openSettingsWindow: mocks.openSettingsWindow,
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

describe('settings ipc', () => {
  it('打开设置窗口并返回成功响应', async () => {
    const service = new SettingsIpcService()
    const resp = await service.openSettingsWindow()

    expect(resp.success).toBe(true)
    expect(mocks.openSettingsWindow).toHaveBeenCalled()
  })
})
