import type { IMessage, UpdateMessageSchema } from '@ant-chat/shared'
import { createAIMessage, updateMessage } from '@main/db/services'
import { sendToRenderer } from '@main/utils/ipc-events'
import { getMainWindow } from '@main/window'

function emitStreamMessage(message: IMessage) {
  const mainWindow = getMainWindow()
  if (!mainWindow)
    return
  sendToRenderer(mainWindow.webContents, 'chat:stream-message', message)
}

export async function createTaskAssistantMessage(conversationId: string, provider: string, providerId: string, model: string) {
  const message = await createAIMessage(conversationId, { provider, providerId, model })
  emitStreamMessage(message)
  return message
}

export async function updateTaskAssistantMessage(messageId: string, patch: Omit<UpdateMessageSchema, 'id' | 'role'>) {
  const message = await updateMessage({
    id: messageId,
    role: 'assistant',
    ...patch,
  })
  emitStreamMessage(message)
  return message
}

export async function finalizeTaskAssistantMessage(messageId: string, text: string, status: 'success' | 'error' | 'cancel') {
  return await updateTaskAssistantMessage(messageId, {
    status,
    content: status === 'error'
      ? [{ type: 'error', error: text }]
      : [{ type: 'text', text }],
  })
}
