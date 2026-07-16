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

    // 浏览器中相对路径可正常解析；在 jsdom/Node 测试环境里相对路径缺少基准地址，
    // 会触发 EventSource 抛出 Invalid URL。用 location.origin 拼成绝对地址规避。
    const baseUrl = typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/api/events`
      : '/api/events'
    eventSource = new EventSource(baseUrl)

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
  // 仅在浏览器原生 EventSource 存在时使用 SSE 适配器。jsdom 测试环境未实现
  // EventSource，却会暴露 Node 全局的 undici EventSource，它和 jsdom 的 Event
  // 体系处于不同 realm，一旦真正发起连接会在重连时抛出未捕获异常。此类环境走 noop。
  else if (typeof window !== 'undefined' && typeof window.EventSource === 'function') {
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
