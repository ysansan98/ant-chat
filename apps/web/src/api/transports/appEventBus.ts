import type { AppRendererEvents, ElectronOnlyEvents } from '@ant-chat/shared'

type AllEvents = AppRendererEvents & ElectronOnlyEvents
type AppEventChannel = keyof AllEvents & string
type AppEventHandler<K extends AppEventChannel> = (event: unknown, payload: AllEvents[K]) => void

export interface AppEventBus {
  on: <K extends AppEventChannel>(channel: K, handler: AppEventHandler<K>) => void
  removeListener: <K extends AppEventChannel>(channel: K, handler: AppEventHandler<K>) => void
  removeAllListeners: (channel?: AppEventChannel) => void
}

// ---- Electron adapter ----

function getElectronIpcRenderer() {
  return globalThis.window?.electron?.ipcRenderer ?? null
}

function createElectronEventBus(): AppEventBus {
  const renderer = getElectronIpcRenderer()!
  return {
    on(channel, handler) {
      renderer.on(channel, handler as (...args: unknown[]) => void)
    },
    removeListener(channel, handler) {
      renderer.removeListener(channel, handler as (...args: unknown[]) => void)
    },
    removeAllListeners(channel) {
      renderer.removeAllListeners(channel!)
    },
  }
}

// ---- Web SSE adapter ----

function createSseEventBus(): AppEventBus {
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>()
  const nativeListeners = new Map<string, EventListener>()
  let eventSource: EventSource | null = null

  function ensureConnected() {
    if (eventSource)
      return

    eventSource = new EventSource('/api/events')

    eventSource.onmessage = () => {
      // fallback for messages without event type
    }

    eventSource.onerror = () => {
      // EventSource auto-reconnects on error
    }
  }

  function bindChannel(channel: string) {
    if (!eventSource)
      return
    const listener: EventListener = ((e: MessageEvent) => {
      const data = JSON.parse(e.data)
      const handlers = listeners.get(channel)
      if (!handlers)
        return
      for (const handler of handlers) {
        handler(null, data)
      }
    }) as EventListener
    nativeListeners.set(channel, listener)
    eventSource.addEventListener(channel, listener)
  }

  function unbindChannel(channel: string) {
    const listener = nativeListeners.get(channel)
    if (listener && eventSource) {
      eventSource.removeEventListener(channel, listener)
      nativeListeners.delete(channel)
    }
  }

  return {
    on(channel, handler) {
      ensureConnected()

      let handlers = listeners.get(channel)
      if (!handlers) {
        handlers = new Set()
        listeners.set(channel, handlers)
        bindChannel(channel)
      }
      handlers.add(handler as (event: unknown, ...args: unknown[]) => void)
    },
    removeListener(channel, handler) {
      const handlers = listeners.get(channel)
      if (handlers) {
        handlers.delete(handler as (event: unknown, ...args: unknown[]) => void)
        if (handlers.size === 0) {
          listeners.delete(channel)
          unbindChannel(channel)
        }
      }
    },
    removeAllListeners(channel) {
      if (channel) {
        listeners.delete(channel)
        unbindChannel(channel)
      }
      else {
        for (const ch of nativeListeners.keys()) {
          unbindChannel(ch)
        }
        listeners.clear()
      }
    },
  }
}

// ---- No-op adapter (test environments without EventSource) ----

function createNoopEventBus(): AppEventBus {
  return {
    on() {},
    removeListener() {},
    removeAllListeners() {},
  }
}

// ---- Factory ----

let cached: AppEventBus | null = null

export function getAppEventBus(): AppEventBus {
  if (cached)
    return cached

  if (getElectronIpcRenderer()) {
    cached = createElectronEventBus()
  }
  else if (typeof EventSource !== 'undefined') {
    cached = createSseEventBus()
  }
  else {
    cached = createNoopEventBus()
  }

  return cached
}

export function clearAppEventBusCache(): void {
  cached = null
}

export { createSseEventBus }
