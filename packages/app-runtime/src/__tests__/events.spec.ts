import { describe, expect, it, vi } from 'vitest'
import { RuntimeEventBus } from '../events'

describe('runtime event bus', () => {
  it('delivers typed domain events and supports unsubscribe', () => {
    const events = new RuntimeEventBus()
    const listener = vi.fn()
    const unsubscribe = events.on('settings.changed', listener)

    events.emit('settings.changed', { keys: ['proxySettings'] })
    unsubscribe()
    events.emit('settings.changed', { keys: ['assistantModelId'] })

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith({ keys: ['proxySettings'] })
  })
})
