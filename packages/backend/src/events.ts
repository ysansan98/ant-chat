import type { AppRendererEvents } from '@ant-chat/shared'

export type AppRuntimeEvents = AppRendererEvents
export type AppRuntimeEventName = keyof AppRuntimeEvents
export type AppRuntimeEventListener<K extends AppRuntimeEventName> = (event: AppRuntimeEvents[K]) => void

export interface AppRuntimeEventBus {
  on: <K extends AppRuntimeEventName>(name: K, listener: AppRuntimeEventListener<K>) => () => void
}

export class RuntimeEventBus implements AppRuntimeEventBus {
  private readonly listeners = new Map<AppRuntimeEventName, Set<(event: never) => void>>()

  on<K extends AppRuntimeEventName>(name: K, listener: AppRuntimeEventListener<K>): () => void {
    const listeners = this.listeners.get(name) ?? new Set()
    listeners.add(listener as (event: never) => void)
    this.listeners.set(name, listeners)
    return () => listeners.delete(listener as (event: never) => void)
  }

  emit<K extends AppRuntimeEventName>(name: K, event: AppRuntimeEvents[K]): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(event as never)
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
