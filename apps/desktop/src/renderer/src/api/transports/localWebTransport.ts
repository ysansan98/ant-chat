import type { AppTransport } from './appTransport'

const LOCAL_API_BASE = 'http://127.0.0.1:17331'

export function createLocalWebTransport(): AppTransport {
  return {
    chat: {
      createConversationsTitle: options => rpc('chat.createConversationsTitle', { ...options }),
      getConversations: (pageIndex, pageSize) => rpc('chat.getConversations', { pageIndex, pageSize }),
      getWorkspaceConversations: (workspacePath, pageIndex, pageSize) => rpc('chat.getWorkspaceConversations', { workspacePath, pageIndex, pageSize }),
      getConversationById: id => rpc('chat.getConversationById', { id }),
      addConversation: conversation => rpc('chat.addConversation', { conversation }),
      updateConversation: conversation => rpc('chat.updateConversation', { conversation }),
      deleteConversation: id => rpc('chat.deleteConversation', { id }),
      getMessagesByConvId: convId => rpc('chat.getMessagesByConvId', { convId }),
      getMessageById: id => rpc('chat.getMessageById', { id }),
      addMessage: message => rpc('chat.addMessage', { message }),
      updateMessage: message => rpc('chat.updateMessage', { message }),
      deleteMessage: id => rpc('chat.deleteMessage', { id }),
      getMessagesByConvIdWithPagination: (id, pageIndex, pageSize) => rpc('chat.getMessagesByConvIdWithPagination', { id, pageIndex, pageSize }),
      batchDeleteMessages: ids => rpc('chat.batchDeleteMessages', { ids }),
    },
    settings: {
      getSettings: () => rpc('settings.getSettings'),
      updateSettings: updates => rpc('settings.updateSettings', { updates }),
      resetSettings: () => rpc('settings.resetSettings'),
    },
    agent: {
      startTurn: options => rpc('agent.startTurn', { options }),
      approvePendingAction: options => rpc('agent.approvePendingAction', { options }),
      rejectPendingAction: options => rpc('agent.rejectPendingAction', { options }),
      cancelTask: taskId => rpc('agent.cancelTask', { taskId }),
      listActiveTasks: conversationId => rpc('agent.listActiveTasks', { conversationId }),
    },
  }
}

async function rpc<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${LOCAL_API_BASE}/api/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params: params ?? {} }),
  })
  const payload = await response.json() as { success: boolean, data?: T, msg?: string }

  if (!payload.success) {
    throw new Error(payload.msg || `Local API failed: ${method}`)
  }

  return payload.data as T
}
