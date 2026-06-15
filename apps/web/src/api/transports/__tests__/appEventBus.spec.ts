import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('sse event bus', () => {
  let addEventListener: ReturnType<typeof vi.fn>
  let removeEventListener: ReturnType<typeof vi.fn>
  let bus: import('../appEventBus').AppEventBus
  let originalEventSource: typeof EventSource | undefined

  beforeEach(async () => {
    addEventListener = vi.fn()
    removeEventListener = vi.fn()

    originalEventSource = globalThis.EventSource

    class MockEventSource {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      constructor(_url: string) {}
      addEventListener = addEventListener
      removeEventListener = removeEventListener
    }

    globalThis.EventSource = MockEventSource as unknown as typeof EventSource
    vi.resetModules()

    const mod = await import('../appEventBus')
    bus = mod.createSseEventBus()
  })

  afterEach(() => {
    if (originalEventSource) {
      globalThis.EventSource = originalEventSource
    }
    else {
      delete (globalThis as any).EventSource
    }
    vi.restoreAllMocks()
  })

  it('registers one native listener for multiple handlers on the same channel', () => {
    console.log('Test started')
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    console.log('Calling bus.on first time')
    bus.on('message:updated', handler1)
    console.log('addEventListener calls after first on:', addEventListener.mock.calls.length)

    console.log('Calling bus.on second time')
    bus.on('message:updated', handler2)
    console.log('addEventListener calls after second on:', addEventListener.mock.calls.length)

    expect(addEventListener).toHaveBeenCalledOnce()
    expect(addEventListener).toHaveBeenCalledWith('message:updated', expect.any(Function))
  })

  it('does not unbind native listener when removing one of multiple handlers', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    bus.on('message:updated', handler1)
    bus.on('message:updated', handler2)
    bus.removeListener('message:updated', handler1)

    expect(removeEventListener).not.toHaveBeenCalled()
  })

  it('unbinds native listener when removing the last handler', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    bus.on('message:updated', handler1)
    bus.on('message:updated', handler2)

    const savedListener = addEventListener.mock.calls[0][1]

    bus.removeListener('message:updated', handler1)
    bus.removeListener('message:updated', handler2)

    expect(removeEventListener).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalledWith('message:updated', savedListener)
  })

  it('unbinds native listener for removeAllListeners(channel)', () => {
    const handler = vi.fn()

    bus.on('message:updated', handler)
    const savedListener = addEventListener.mock.calls[0][1]

    bus.removeAllListeners('message:updated')

    expect(removeEventListener).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalledWith('message:updated', savedListener)
  })

  it('unbinds all native listeners for removeAllListeners() without channel', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()

    bus.on('message:updated', handler1)
    bus.on('conversation:updated', handler2)

    const savedListener1 = addEventListener.mock.calls.find(c => c[0] === 'message:updated')![1]
    const savedListener2 = addEventListener.mock.calls.find(c => c[0] === 'conversation:updated')![1]

    bus.removeAllListeners()

    expect(removeEventListener).toHaveBeenCalledTimes(2)
    expect(removeEventListener).toHaveBeenCalledWith('message:updated', savedListener1)
    expect(removeEventListener).toHaveBeenCalledWith('conversation:updated', savedListener2)
  })

  it('dispatches parsed data to handlers when native listener fires', () => {
    const handler = vi.fn()

    bus.on('message:updated', handler)

    const nativeListener = addEventListener.mock.calls[0][1]
    const payload = { message: { id: 'msg-1', content: [] } }
    nativeListener(new MessageEvent('message:updated', { data: JSON.stringify(payload) }))

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(null, payload)
  })
})
