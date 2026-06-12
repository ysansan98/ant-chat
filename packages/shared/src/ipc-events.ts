import type { AgentPendingAction, AgentTaskSnapshot, IConversations, IMessage, NotificationOption, ProgressInfo, UpdateError, UpdateInfo, UpdateStatus } from './interfaces'

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
 * 跨平台渲染进程事件 - web 和 desktop 共享
 */
export interface AppRendererEvents {
  'conversation:updated': { conversation: IConversations }
  'message:updated': { message: IMessage }
  'agent:task-updated': { task: AgentTaskSnapshot }
  'agent:approval-required': { taskId: string, conversationId: string, pendingAction: AgentPendingAction }
  'workspace:changed': { currentWorkspacePath: string }
  'settings:updated': { keys: string[] }
  'mcp:status-changed': { serverName: string, status: 'connected' | 'disconnected', error?: string }
  'provider:changed': { providerId?: string }
}

/**
 * Electron 专用事件
 */
export interface ElectronOnlyEvents {
  'common:Notification': NotificationOption
  'update:update-status-changed': { status: UpdateStatus, updateInfo: UpdateInfo | null }
  'update:update-available': { status: UpdateStatus, updateInfo: UpdateInfo | null }
  'update:update-not-available': never
  'update:download-progress': ProgressInfo
  'update:update-downloaded': UpdateInfo
  'update:update-error': UpdateError
}

/**
 * 渲染进程接收的事件（合并跨平台和 Electron 专用）
 */
export type IpcRendererEvent = AppRendererEvents & ElectronOnlyEvents
