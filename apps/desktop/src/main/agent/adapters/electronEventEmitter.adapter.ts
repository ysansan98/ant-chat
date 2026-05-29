import type { IAgentEventEmitter } from '@ant-chat/shared'
import { sendToRenderer } from '@main/utils/ipc-events'
import { getMainWindow } from '@main/windows/window'

export function createElectronEventEmitter(): IAgentEventEmitter {
  function ipc(channel: string, data: unknown) {
    const win = getMainWindow()
    if (!win)
      return
    sendToRenderer(win.webContents, channel, data)
  }

  return {
    emitMessageUpdated(message) {
      ipc('message:updated', message)
    },
    emitTaskUpdated(task) {
      ipc('agent:state-updated', { task })
    },
    emitApprovalRequired(taskId, conversationId, pendingAction) {
      ipc('agent:approval-required', { taskId, conversationId, pendingAction })
    },
    emitTurnStarted() {},
    emitTurnChunk() {},
    emitTurnToolCalls() {},
    emitTurnToolResults() {},
    emitTurnFinished() {},
  }
}
