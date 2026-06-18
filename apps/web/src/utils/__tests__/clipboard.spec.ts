import { installClipboardTextFallback, writeClipboardText } from '@workspace/ui/lib/clipboard'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('clipboard fallback', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const originalExecCommand = document.execCommand

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard)
    }
    else {
      Reflect.deleteProperty(navigator, 'clipboard')
    }

    document.execCommand = originalExecCommand
    vi.restoreAllMocks()
  })

  it('clipboard API 不可用时仍通过浏览器 selection 复制文本', async () => {
    const execCommand = vi.fn(() => true)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    document.execCommand = execCommand

    await writeClipboardText('复制内容')

    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('第三方组件调用 clipboard.write 失败时复制 text/plain 内容', async () => {
    const execCommand = vi.fn(() => true)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: vi.fn().mockRejectedValue(new Error('denied')),
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    })
    document.execCommand = execCommand

    const uninstall = installClipboardTextFallback()
    await navigator.clipboard.write([
      {
        getType: async () => new Blob(['| A | B |'], { type: 'text/plain' }),
        presentationStyle: 'unspecified',
        types: ['text/plain'],
      } as unknown as ClipboardItem,
    ])
    uninstall()

    expect(execCommand).toHaveBeenCalledWith('copy')
  })
})
