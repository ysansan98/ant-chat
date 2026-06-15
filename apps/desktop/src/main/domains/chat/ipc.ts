import type { AddConversationsSchema, handleInitConversationTitleOptions, IConversations, IMessage, IpcPaginatedResponse, IpcResponse, UpdateConversationsSchema } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcPaginatedResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppRuntime } from '@main/runtime/appRuntime'
import { logger } from '@main/utils/logger'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class ChatIpcService extends IpcService {
  static readonly groupName = 'chat'

  @IpcMethod()
  async createConversationsTitle(options: handleInitConversationTitleOptions): Promise<IpcResponse<IConversations>> {
    try {
      logger.info('IPC Event: chat:create-conversations-title', options)
      const updatedConversations = await getAppRuntime().chat.createConversationTitle(options.conversationsId, options.modelId)
      return createIpcResponse(true, updatedConversations)
    }
    catch (error) {
      logger.error('初始化会话标题失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getConversations(pageIndex: number, pageSize: number): Promise<IpcPaginatedResponse<IConversations[]>> {
    try {
      const { data, total } = await getAppRuntime().chat.listConversations(pageIndex, pageSize)
      return createIpcPaginatedResponse(true, data, '', total)
    }
    catch (error) {
      logger.error('获取会话列表失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getWorkspaceConversations(workspacePath: string, pageIndex: number, pageSize: number): Promise<IpcPaginatedResponse<IConversations[]>> {
    try {
      const { data, total } = await getAppRuntime().chat.listConversations(pageIndex, pageSize, workspacePath)
      return createIpcPaginatedResponse(true, data, '', total)
    }
    catch (error) {
      logger.error('获取工作区会话列表失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getConversationById(id: string): Promise<IpcResponse<IConversations>> {
    try {
      const data = await getAppRuntime().chat.getConversation(id)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('获取会话详情失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async addConversation(conversation: AddConversationsSchema): Promise<IpcResponse<IConversations>> {
    try {
      const data = await getAppRuntime().chat.createConversation(conversation)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('添加会话失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async updateConversation(conversation: UpdateConversationsSchema): Promise<IpcResponse<IConversations>> {
    try {
      const data = await getAppRuntime().chat.updateConversation(conversation)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('更新会话失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteConversation(id: string): Promise<IpcResponse<null>> {
    try {
      await getAppRuntime().chat.deleteConversation(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('删除会话失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async clearWorkspaceConversations(workspacePath: string): Promise<IpcResponse<string[]>> {
    try {
      const deletedIds = await getAppRuntime().chat.clearWorkspaceConversations(workspacePath)
      return createIpcResponse(true, deletedIds)
    }
    catch (error) {
      logger.error('清空工作区会话失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getMessagesByConvId(id: string): Promise<IpcResponse<IMessage[]>> {
    try {
      const data = await getAppRuntime().chat.listMessages(id)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('获取消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getMessageById(id: string): Promise<IpcResponse<IMessage>> {
    try {
      const data = await getAppRuntime().chat.getMessage(id)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('获取消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async addMessage(message: IMessage): Promise<IpcResponse<IMessage>> {
    try {
      const data = await getAppRuntime().chat.createMessage(message)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('添加消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async updateMessage(message: IMessage): Promise<IpcResponse<IMessage>> {
    try {
      const data = await getAppRuntime().chat.updateMessage(message)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('更新消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async deleteMessage(id: string): Promise<IpcResponse<null>> {
    try {
      await getAppRuntime().chat.deleteMessage(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('删除消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async batchDeleteMessages(ids: string[]): Promise<IpcResponse<null>> {
    try {
      await getAppRuntime().chat.batchDeleteMessages(ids)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('批量删除消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }
}
