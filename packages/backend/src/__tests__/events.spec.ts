import { describe, expect, it, vi } from 'vitest'
import { RuntimeEventBus } from '../events'

describe('runtime event bus', () => {
  it('delivers typed domain events and supports unsubscribe', () => {
    const events = new RuntimeEventBus()
    const listener = vi.fn()
    const unsubscribe = events.on('settings:updated', listener)

    events.emit('settings:updated', { keys: ['proxySettings'] })
    unsubscribe()
    events.emit('settings:updated', { keys: ['assistantModelId'] })

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({ keys: ['proxySettings'] })
  })
})
