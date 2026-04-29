import type { AgentPendingAction, AgentProgressItem, AgentTaskSnapshot, IpcRendererEvent } from '@ant-chat/shared'
import { sendToRenderer } from '@main/utils/ipc-events'
import { getMainWindow } from '@main/window'

function emit<T extends keyof IpcRendererEvent & string>(channel: T, payload: IpcRendererEvent[T][0]) {
  const mainWindow = getMainWindow()
  if (!mainWindow)
    return
  sendToRenderer(mainWindow.webContents, channel, payload as never)
}

export function reportTaskState(task: AgentTaskSnapshot) {
  emit('agent:state-updated', { task })
}

export function reportTaskProgress(taskId: string, conversationId: string, progress: AgentProgressItem[]) {
  emit('agent:progress-updated', { taskId, conversationId, progress })
}

export function reportApprovalRequired(taskId: string, conversationId: string, pendingAction: AgentPendingAction) {
  emit('agent:approval-required', { taskId, conversationId, pendingAction })
}
