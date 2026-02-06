import type { AddConversationsSchema, handleChatCompletionsOptions, handleInitConversationTitleOptions, IConversations, IMessage, IpcPaginatedResponse, IpcResponse, UpdateConversationsSchema } from '@ant-chat/shared'
import { AddMessage, createErrorIpcResponse, createIpcPaginatedResponse, createIpcResponse, UpdateMessageSchema } from '@ant-chat/shared'
import { handleChatCompletions, handleInitConversationTitle } from '@main/ai-providers/services/chat-service'
import { StreamAbortController } from '@main/ai-providers/utils/StreamAbortController'
import { services } from '@main/db'
import { updateConversation } from '@main/db/services'
import { logger } from '@main/utils/logger'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class ChatIpcService extends IpcService {
  static readonly groupName = 'chat'

  @IpcMethod()
  async sendChatCompletions(options: handleChatCompletionsOptions): Promise<void> {
    await handleChatCompletions(options)
  }

  @IpcMethod()
  async cancelChatCompletions(conversationsId: string): Promise<void> {
    StreamAbortController.abortConversationsStream(conversationsId)
  }

  @IpcMethod()
  async createConversationsTitle(options: handleInitConversationTitleOptions): Promise<IpcResponse<IConversations>> {
    logger.info('IPC Event: chat:create-conversations-title', options)
    const title = await handleInitConversationTitle(options)
    const udpatedConversations = await updateConversation({
      id: options.conversationsId,
      title,
    })
    return createIpcResponse(true, udpatedConversations)
  }

  @IpcMethod()
  async getConversations(pageIndex: number, pageSize: number): Promise<IpcPaginatedResponse<IConversations[]>> {
    try {
      const total = await services.getConversationsTotal()
      const data = await services.getConversations(pageIndex, pageSize)
      return createIpcPaginatedResponse(true, data, '', total)
    }
    catch (error) {
      logger.error('获取会话列表失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getConversationById(id: string): Promise<IpcResponse<IConversations>> {
    try {
      const data = await services.getConversationById(id)
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
      const data = await services.addConversation(conversation)
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
      const data = await services.updateConversation(conversation)
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
      await services.deleteConversation(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('删除会话失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getMessagesByConvId(id: string): Promise<IpcResponse<IMessage[]>> {
    try {
      const data = await services.getMessagesByConvId(id)
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
      const data = await services.getMessageById(id)
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
      const msg = AddMessage.parse(message)
      const data = await services.addMessage(msg)
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
      const msg = UpdateMessageSchema.parse(message)
      const data = await services.updateMessage(msg)
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
      await services.deleteMessage(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('删除消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getMessagesByConvIdWithPagination(id: string, pageIndex: number, pageSize: number): Promise<IpcPaginatedResponse<IMessage[]>> {
    try {
      const { data, total } = await services.getMessagesByConvIdWithPagination(id, pageIndex, pageSize)
      return createIpcPaginatedResponse(true, data, '', total)
    }
    catch (error) {
      logger.error(`分页获取会话消息失败. convId: ${id}`, error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async batchDeleteMessages(ids: string[]): Promise<IpcResponse<null>> {
    try {
      await services.batchDeleteMessages(ids)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('批量删除消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }
}
