export interface AppEventBus {
  on: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => void
  removeListener: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => void
  removeAllListeners: (channel?: string) => void
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
  // channel → Set<handler>
  const listeners = new Map<string, Set<(event: unknown, ...args: unknown[]) => void>>()
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
    eventSource.addEventListener(channel, ((e: MessageEvent) => {
      const data = JSON.parse(e.data)
      const handlers = listeners.get(channel)
      if (!handlers)
        return
      for (const handler of handlers) {
        // Match Electron signature: (event, data)
        // First arg is the IPC event object (not used in web), second is the payload
        handler(null, data)
      }
    }) as EventListener)
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
      handlers.add(handler)
    },
    removeListener(channel, handler) {
      const handlers = listeners.get(channel)
      if (handlers) {
        handlers.delete(handler)
        if (handlers.size === 0) {
          listeners.delete(channel)
        }
      }
    },
    removeAllListeners(channel) {
      if (channel) {
        listeners.delete(channel)
      }
      else {
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
