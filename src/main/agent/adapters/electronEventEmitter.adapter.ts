import type { IAgentEventEmitter } from '@ant-chat/shared'
import { sendToRenderer } from '@main/utils/ipc-events'
import { getMainWindow } from '@main/window'

export const electronEventEmitter: IAgentEventEmitter = {
  emitTaskUpdated(task) {
    const win = getMainWindow()
    if (!win)
      return
    sendToRenderer(win.webContents, 'agent:state-updated', { task })
  },
  emitApprovalRequired(taskId, conversationId, pendingAction) {
    const win = getMainWindow()
    if (!win)
      return
    sendToRenderer(win.webContents, 'agent:approval-required', { taskId, conversationId, pendingAction })
  },
  emitMessageUpdated(message) {
    const win = getMainWindow()
    if (!win)
      return
    sendToRenderer(win.webContents, 'message:updated', message)
  },
}
