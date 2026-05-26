import type { IpcServices } from '@main/bridge'
import type { AppTransport } from './appTransport'
import { createIpcProxy } from 'electron-ipc-decorator/client'
import { unwrapIpcPaginatedResponse, unwrapIpcResponse } from '@/utils/ipc-bus'

export function createElectronIpcTransport(): AppTransport {
  const ipc = createIpcProxy<IpcServices>(window.electron.ipcRenderer)!

  return {
    chat: {
      createConversationsTitle: options => ipc.chat.createConversationsTitle(options),
      getConversations: async (pageIndex, pageSize) => unwrapIpcPaginatedResponse(await ipc.chat.getConversations(pageIndex, pageSize)),
      getWorkspaceConversations: async (workspacePath, pageIndex, pageSize) => unwrapIpcPaginatedResponse(await ipc.chat.getWorkspaceConversations(workspacePath, pageIndex, pageSize)),
      getConversationById: async id => unwrapIpcResponse(await ipc.chat.getConversationById(id)),
      addConversation: async conversation => unwrapIpcResponse(await ipc.chat.addConversation(conversation)),
      updateConversation: async conversation => unwrapIpcResponse(await ipc.chat.updateConversation(conversation)),
      deleteConversation: async id => unwrapIpcResponse(await ipc.chat.deleteConversation(id)),
      getMessagesByConvId: async convId => unwrapIpcResponse(await ipc.chat.getMessagesByConvId(convId)),
      getMessageById: async id => unwrapIpcResponse(await ipc.chat.getMessageById(id)),
      addMessage: async message => unwrapIpcResponse(await ipc.chat.addMessage(message)),
      updateMessage: async message => unwrapIpcResponse(await ipc.chat.updateMessage(message)),
      deleteMessage: async id => unwrapIpcResponse(await ipc.chat.deleteMessage(id)),
      getMessagesByConvIdWithPagination: async (id, pageIndex, pageSize) => unwrapIpcPaginatedResponse(await ipc.chat.getMessagesByConvIdWithPagination(id, pageIndex, pageSize)),
      batchDeleteMessages: async ids => unwrapIpcResponse(await ipc.chat.batchDeleteMessages(ids)),
    },
    settings: {
      getSettings: async () => unwrapIpcResponse(await ipc.settings.getSettings()),
      updateSettings: async updates => unwrapIpcResponse(await ipc.settings.updateSettings(updates)),
      resetSettings: async () => unwrapIpcResponse(await ipc.settings.resetSettings()),
    },
    agent: {
      startTurn: async options => unwrapIpcResponse(await ipc.agent.startTurn(options)),
      approvePendingAction: async options => unwrapIpcResponse(await ipc.agent.approvePendingAction(options)),
      rejectPendingAction: async options => unwrapIpcResponse(await ipc.agent.rejectPendingAction(options)),
      cancelTask: async taskId => unwrapIpcResponse(await ipc.agent.cancelTask({ taskId })),
      listActiveTasks: async conversationId => unwrapIpcResponse(await ipc.agent.listActiveTasks(conversationId)),
      approvePendingActionWithWhitelist: async options => unwrapIpcResponse(await ipc.agent.approvePendingActionWithWhitelist(options)),
    },
  }
}
