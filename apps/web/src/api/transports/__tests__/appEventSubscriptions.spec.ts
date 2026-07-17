import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSseEventSubscriptions,
  disposeAppEventSubscriptions,
  getAppEventSubscriptions,
} from '../appEventSubscriptions'

describe('浏览器应用事件订阅', () => {
  let addEventListener: ReturnType<typeof vi.fn>
  let removeEventListener: ReturnType<typeof vi.fn>
  let close: ReturnType<typeof vi.fn>
  let subscriptions: ReturnType<typeof createSseEventSubscriptions>
  let originalEventSource: typeof EventSource | undefined

  beforeEach(() => {
    addEventListener = vi.fn()
    removeEventListener = vi.fn()
    close = vi.fn()
    originalEventSource = globalThis.EventSource

    class MockEventSource {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      constructor(_url: string) {}
      addEventListener = addEventListener
      removeEventListener = removeEventListener
      close = close
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
    subscriptions = createSseEventSubscriptions()
  })

  afterEach(() => {
    subscriptions.dispose()
    if (originalEventSource)
      globalThis.EventSource = originalEventSource
    else
      delete (globalThis as { EventSource?: typeof EventSource }).EventSource
    vi.restoreAllMocks()
  })

  it('同 channel 的多个订阅只注册一个原生 listener', () => {
    subscriptions.subscribe('message:updated', vi.fn())
    subscriptions.subscribe('message:updated', vi.fn())

    expect(addEventListener).toHaveBeenCalledOnce()
    expect(addEventListener).toHaveBeenCalledWith('message:updated', expect.any(Function))
  })

  it('释放一个订阅时不影响同 channel 的其他订阅', () => {
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()
    const unsubscribeFirst = subscriptions.subscribe('message:updated', firstHandler)
    subscriptions.subscribe('message:updated', secondHandler)

    unsubscribeFirst()
    emitSseEvent(addEventListener, 'message:updated', { message: { id: 'msg-1', content: [] } })

    expect(firstHandler).not.toHaveBeenCalled()
    expect(secondHandler).toHaveBeenCalledWith({ message: { id: 'msg-1', content: [] } })
    expect(removeEventListener).not.toHaveBeenCalled()
  })

  it('最后一个订阅释放时解绑原生 listener，且重复释放无副作用', () => {
    const unsubscribe = subscriptions.subscribe('message:updated', vi.fn())
    const nativeListener = addEventListener.mock.calls[0][1]

    unsubscribe()
    unsubscribe()

    expect(removeEventListener).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalledWith('message:updated', nativeListener)
  })

  it('同一个 handler 重复订阅时保持独立所有权', () => {
    const handler = vi.fn()
    const unsubscribeFirst = subscriptions.subscribe('message:updated', handler)
    subscriptions.subscribe('message:updated', handler)

    emitSseEvent(addEventListener, 'message:updated', { message: { id: 'first', content: [] } })
    unsubscribeFirst()
    emitSseEvent(addEventListener, 'message:updated', { message: { id: 'second', content: [] } })

    expect(handler).toHaveBeenCalledTimes(3)
    expect(handler).toHaveBeenLastCalledWith({ message: { id: 'second', content: [] } })
  })

  it('一个订阅者抛错时继续通知其他订阅者', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const secondHandler = vi.fn()
    subscriptions.subscribe('message:updated', () => {
      throw new Error('订阅失败')
    })
    subscriptions.subscribe('message:updated', secondHandler)

    emitSseEvent(addEventListener, 'message:updated', { message: { id: 'msg-1', content: [] } })

    expect(secondHandler).toHaveBeenCalledWith({ message: { id: 'msg-1', content: [] } })
    expect(console.error).toHaveBeenCalledWith('应用事件订阅处理失败: message:updated', expect.any(Error))
  })

  it('异步订阅者拒绝时记录错误且不产生未处理 rejection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    subscriptions.subscribe('message:updated', async () => {
      throw new Error('异步订阅失败')
    })

    emitSseEvent(addEventListener, 'message:updated', { message: { id: 'msg-1', content: [] } })
    await Promise.resolve()

    expect(console.error).toHaveBeenCalledWith('应用事件订阅处理失败: message:updated', expect.any(Error))
  })

  it('payload 不是合法 JSON 时不通知订阅者', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = vi.fn()
    subscriptions.subscribe('message:updated', handler)

    const nativeListener = addEventListener.mock.calls[0][1]
    nativeListener(new MessageEvent('message:updated', { data: '{invalid' }))

    expect(handler).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith('应用事件订阅处理失败: message:updated', expect.any(SyntaxError))
  })

  it('销毁 module 时解绑所有 channel 并关闭 EventSource', () => {
    subscriptions.subscribe('message:updated', vi.fn())
    subscriptions.subscribe('conversation:updated', vi.fn())

    subscriptions.dispose()
    subscriptions.dispose()

    expect(removeEventListener).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
    expect(() => subscriptions.subscribe('message:updated', vi.fn())).toThrow('应用事件订阅 module 已销毁')
  })
})

describe('桌面端应用事件订阅', () => {
  const originalElectron = window.electron

  afterEach(() => {
    disposeAppEventSubscriptions()
    window.electron = originalElectron
    vi.restoreAllMocks()
  })

  it('向订阅者只传递业务 payload', () => {
    const on = vi.fn()
    const removeListener = vi.fn()
    window.electron = { ipcRenderer: { on, removeListener } } as unknown as Window['electron']
    const subscriptions = getAppEventSubscriptions()
    const handler = vi.fn()

    const unsubscribe = subscriptions.subscribe('provider:changed', handler)
    const nativeListener = on.mock.calls[0][1]
    const payload = { providerId: 'provider-1' }
    nativeListener({ sender: 'electron' }, payload)
    unsubscribe()

    expect(handler).toHaveBeenCalledWith(payload)
    expect(removeListener).toHaveBeenCalledWith('provider:changed', nativeListener)
  })

  it('同 channel 复用一个原生 listener，释放一个 owner 不影响另一个', () => {
    const on = vi.fn()
    const removeListener = vi.fn()
    window.electron = { ipcRenderer: { on, removeListener } } as unknown as Window['electron']
    const subscriptions = getAppEventSubscriptions()
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()

    const unsubscribeFirst = subscriptions.subscribe('provider:changed', firstHandler)
    const unsubscribeSecond = subscriptions.subscribe('provider:changed', secondHandler)
    unsubscribeFirst()

    const nativeListener = on.mock.calls[0][1]
    const payload = { providerId: 'provider-1' }
    nativeListener({ sender: 'electron' }, payload)

    expect(on).toHaveBeenCalledOnce()
    expect(removeListener).not.toHaveBeenCalled()
    expect(firstHandler).not.toHaveBeenCalled()
    expect(secondHandler).toHaveBeenCalledWith(payload)

    unsubscribeSecond()
    expect(removeListener).toHaveBeenCalledWith('provider:changed', nativeListener)
  })

  it('运行时没有可用 transport 时明确失败', () => {
    const originalEventSource = window.EventSource
    window.electron = undefined as unknown as Window['electron']
    window.EventSource = undefined as unknown as typeof EventSource

    try {
      expect(() => getAppEventSubscriptions()).toThrow('当前运行时不支持应用事件订阅')
    }
    finally {
      window.EventSource = originalEventSource
    }
  })
})

function emitSseEvent(
  addEventListener: ReturnType<typeof vi.fn>,
  channel: string,
  payload: unknown,
): void {
  const nativeListener = addEventListener.mock.calls.find(call => call[0] === channel)?.[1]
  if (!nativeListener)
    throw new Error(`未找到原生 listener: ${channel}`)
  nativeListener(new MessageEvent(channel, { data: JSON.stringify(payload) }))
}
