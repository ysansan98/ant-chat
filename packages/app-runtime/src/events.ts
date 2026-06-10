import type { AgentPendingAction, AgentTaskSnapshot, IMessage } from '@ant-chat/shared'

export interface AppRuntimeEvents {
  'message.updated': { message: IMessage }
  'agent.task.updated': { task: AgentTaskSnapshot }
  'agent.approval.required': {
    taskId: string
    conversationId: string
    pendingAction: AgentPendingAction
  }
  'workspace.changed': { currentWorkspacePath: string }
  'provider.changed': { providerId?: string }
  'settings.changed': { keys: string[] }
  'mcp.connection.changed': {
    serverName: string
    status: 'connected' | 'disconnected'
    error?: string
  }
}

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
