import type { AppRendererEvents, ElectronOnlyEvents } from '@ant-chat/shared'
import { isElectronRuntime } from '@/utils/ipc-bus'

type AllEvents = AppRendererEvents & ElectronOnlyEvents
type AppEventChannel = keyof AllEvents & string
type AppEventHandler<K extends AppEventChannel> = (payload: AllEvents[K]) => void | Promise<void>
type Unsubscribe = () => void
type DispatchPayload = (payload: unknown) => void

export interface AppEventSubscriptions {
  subscribe: <K extends AppEventChannel>(channel: K, handler: AppEventHandler<K>) => Unsubscribe
}

interface ManagedAppEventSubscriptions extends AppEventSubscriptions {
  dispose: () => void
}

interface EventTransportAdapter {
  bindChannel: (channel: AppEventChannel, dispatch: DispatchPayload) => void
  unbindChannel: (channel: AppEventChannel) => void
  dispose: () => void
}

interface Subscriber {
  // 不直接保存 handler：同一函数重复订阅时，每次订阅必须拥有独立的释放权。
  deliver: DispatchPayload
}

function reportSubscriptionError(channel: AppEventChannel, error: unknown): void {
  console.error(`应用事件订阅处理失败: ${channel}`, error)
}

function deliver<K extends AppEventChannel>(
  channel: K,
  handler: AppEventHandler<K>,
  payload: AllEvents[K],
): void {
  // 一个订阅者失败不能阻断同 channel 的其他订阅者；异步 rejection 也在这里统一收口。
  try {
    void Promise.resolve(handler(payload)).catch(error => reportSubscriptionError(channel, error))
  }
  catch (error) {
    reportSubscriptionError(channel, error)
  }
}

function createManagedEventSubscriptions(adapter: EventTransportAdapter): ManagedAppEventSubscriptions {
  const subscribers = new Map<AppEventChannel, Set<Subscriber>>()
  let disposed = false

  function dispatch(channel: AppEventChannel, payload: unknown): void {
    for (const subscriber of [...(subscribers.get(channel) ?? [])])
      subscriber.deliver(payload)
  }

  return {
    subscribe(channel, handler) {
      if (disposed)
        throw new Error('应用事件订阅 module 已销毁')

      const subscriber: Subscriber = {
        deliver: payload => deliver(channel, handler, payload as AllEvents[typeof channel]),
      }
      let channelSubscribers = subscribers.get(channel)
      if (!channelSubscribers) {
        channelSubscribers = new Set([subscriber])
        subscribers.set(channel, channelSubscribers)
        try {
          adapter.bindChannel(channel, payload => dispatch(channel, payload))
        }
        catch (error) {
          subscribers.delete(channel)
          throw error
        }
      }
      else {
        channelSubscribers.add(subscriber)
      }

      let active = true
      return () => {
        if (!active)
          return
        active = false
        channelSubscribers.delete(subscriber)
        if (channelSubscribers.size === 0) {
          subscribers.delete(channel)
          adapter.unbindChannel(channel)
        }
      }
    },
    dispose() {
      if (disposed)
        return
      disposed = true
      for (const channel of [...subscribers.keys()])
        adapter.unbindChannel(channel)
      subscribers.clear()
      adapter.dispose()
    },
  }
}

function createElectronTransportAdapter(renderer: Window['electron']['ipcRenderer']): EventTransportAdapter {
  const nativeListeners = new Map<AppEventChannel, (...args: unknown[]) => void>()

  return {
    bindChannel(channel, dispatch) {
      const listener = (_event: unknown, payload: unknown) => dispatch(payload)
      renderer.on(channel, listener)
      nativeListeners.set(channel, listener)
    },
    unbindChannel(channel) {
      const listener = nativeListeners.get(channel)
      if (!listener)
        return
      renderer.removeListener(channel, listener)
      nativeListeners.delete(channel)
    },
    // ipcRenderer 属于 Electron preload，不由 renderer 内的订阅 module 销毁。
    dispose() {},
  }
}

function createSseTransportAdapter(): EventTransportAdapter {
  const nativeListeners = new Map<AppEventChannel, EventListener>()
  let eventSource: EventSource | null = null

  function ensureConnected(): EventSource {
    if (eventSource)
      return eventSource

    const baseUrl = typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/api/events`
      : '/api/events'
    eventSource = new EventSource(baseUrl)
    eventSource.onmessage = () => {}
    eventSource.onerror = () => {}
    return eventSource
  }

  return {
    bindChannel(channel, dispatch) {
      const source = ensureConnected()
      const listener: EventListener = ((event: MessageEvent) => {
        try {
          dispatch(JSON.parse(event.data))
        }
        catch (error) {
          reportSubscriptionError(channel, error)
        }
      }) as EventListener

      source.addEventListener(channel, listener)
      nativeListeners.set(channel, listener)
    },
    unbindChannel(channel) {
      const listener = nativeListeners.get(channel)
      if (!listener || !eventSource)
        return
      eventSource.removeEventListener(channel, listener)
      nativeListeners.delete(channel)
    },
    dispose() {
      eventSource?.close()
      eventSource = null
    },
  }
}

function createElectronEventSubscriptions(): ManagedAppEventSubscriptions {
  return createManagedEventSubscriptions(createElectronTransportAdapter(window.electron.ipcRenderer))
}

export function createSseEventSubscriptions(): ManagedAppEventSubscriptions {
  return createManagedEventSubscriptions(createSseTransportAdapter())
}

let cached: ManagedAppEventSubscriptions | null = null

export function getAppEventSubscriptions(): AppEventSubscriptions {
  if (cached)
    return cached

  if (isElectronRuntime()) {
    cached = createElectronEventSubscriptions()
  }
  else if (typeof window !== 'undefined' && typeof window.EventSource === 'function') {
    cached = createSseEventSubscriptions()
  }
  else {
    throw new TypeError('当前运行时不支持应用事件订阅')
  }

  return cached
}

export function disposeAppEventSubscriptions(): void {
  cached?.dispose()
  cached = null
}
