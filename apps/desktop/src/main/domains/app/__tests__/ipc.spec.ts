import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppIpcService } from '../ipc'

const mocks = vi.hoisted(() => ({
  clipboardWrite: vi.fn(() => true),
}))

vi.mock('electron-ipc-decorator', () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
}))

vi.mock('@main/utils/util', () => ({
  clipboardWrite: mocks.clipboardWrite,
}))

vi.mock('@main/windows/window', () => ({
  getMainWindow: () => null,
}))

describe('app ipc', () => {
  beforeEach(() => {
    mocks.clipboardWrite.mockClear()
  })

  it('合法剪贴板输入保持原行为', async () => {
    const service = new AppIpcService()

    await expect(service.clipboardWrite({ text: 'hello' })).resolves.toBe(true)
    await expect(service.clipboardWrite({ text: 'hello' }, 'clipboard')).resolves.toBe(true)
    expect(mocks.clipboardWrite).toHaveBeenNthCalledWith(1, { text: 'hello' }, undefined)
    expect(mocks.clipboardWrite).toHaveBeenNthCalledWith(2, { text: 'hello' }, 'clipboard')
  })

  it('拒绝非法的 type，且不调用 clipboard', async () => {
    const service = new AppIpcService()

    await expect(service.clipboardWrite({ text: 'hello' }, 'primary' as never)).rejects.toThrow(
      'clipboardWrite 的 type 只能是 selection、clipboard 或 undefined',
    )
    expect(mocks.clipboardWrite).not.toHaveBeenCalled()
  })

  it('拒绝非对象 data', async () => {
    const service = new AppIpcService()

    for (const data of [null, 'text', ['text'], 1]) {
      await expect(service.clipboardWrite(data as never)).rejects.toThrow(
        'clipboardWrite 的 data 必须是对象',
      )
    }
    expect(mocks.clipboardWrite).not.toHaveBeenCalled()
  })

  it('拒绝未知字段和非字符串文本字段', async () => {
    const service = new AppIpcService()

    await expect(service.clipboardWrite({ text: 'hello', exec: 'rm' } as never)).rejects.toThrow(
      'clipboardWrite 的 data 包含未知字段: exec',
    )
    await expect(service.clipboardWrite({ text: 1 } as never)).rejects.toThrow(
      'clipboardWrite 的 data.text 必须是字符串',
    )
    await expect(service.clipboardWrite({ image: 'not-image' } as never)).rejects.toThrow(
      'clipboardWrite 的 data.image 必须是对象',
    )
    expect(mocks.clipboardWrite).not.toHaveBeenCalled()
  })
})
