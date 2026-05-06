import type { AgentPendingAction, AgentTaskSnapshot, IMessage, NotificationOption, ProgressInfo, UpdateError, UpdateInfo, UpdateStatus } from './interfaces'

export function createIpcResponse<T>(success: boolean, data: T, msg?: string): IpcResponse<T> | ErrorIpcResponse {
  if (success) {
    return { success, data }
  }

  return {
    success,
    msg: msg ?? '',
  }
}

export function createIpcPaginatedResponse<T>(success: boolean, data: T, msg?: string, total?: number): IpcPaginatedResponse<T> {
  if (success) {
    return { success, data, total: total ?? 0 }
  }

  return {
    success,
    msg: msg ?? '',
  }
}

export function createErrorIpcResponse(errMsg: string | Error): ErrorIpcResponse {
  return { success: false, msg: typeof errMsg === 'string' ? errMsg : errMsg.message }
}

interface IpcResponseSuccess<T> {
  success: true
  data: T
}

interface IpcPaginatedResponseSuccess<T> extends IpcResponseSuccess<T> {
  total: number
}

export interface ErrorIpcResponse {
  success: false
  msg: string
}

/**
 * @see https://www.electronjs.org/docs/latest/api/clipboard#clipboardwrite-text
 */
export interface ElectronData {
  text?: string
  html?: string
  image?: any
  rtf?: string
  /**
   * The title of the URL at `text`.
   */
  bookmark?: string
}

export type IpcResponse<T> = IpcResponseSuccess<T> | ErrorIpcResponse

export type IpcPaginatedResponse<T> = IpcPaginatedResponseSuccess<T> | ErrorIpcResponse

/**
 * 这里是在渲染进程中接收的事件
 */
export interface IpcRendererEvent {
  'mcp:McpServerStatusChanged': [string, 'disconnected' | 'connected']
  'common:Notification': [NotificationOption]
  'message:updated': [IMessage]
  'chat:stream-canceled': [string]
  'workspace:changed': [{ currentWorkspacePath: string }]
  'update:update-status-changed': [{ status: UpdateStatus, updateInfo: UpdateInfo | null }]
  'update:update-available': [{ status: UpdateStatus, updateInfo: UpdateInfo | null }]
  'update:update-not-available': []
  'update:download-progress': [ProgressInfo]
  'update:update-downloaded': [UpdateInfo]
  'update:update-error': [UpdateError]
  'agent:state-updated': [{ task: AgentTaskSnapshot }]
  'agent:approval-required': [{ taskId: string, conversationId: string, pendingAction: AgentPendingAction }]
  'settings:updated': [{ keys: string[] }]
  [key: string]: unknown[]
}
