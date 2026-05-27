import type { AddConversationsSchema, handleInitConversationTitleOptions, IConversations, IMessage, IpcPaginatedResponse, IpcResponse, UpdateConversationsSchema } from '@ant-chat/shared'
import { AddMessage, createErrorIpcResponse, createIpcPaginatedResponse, createIpcResponse, UpdateMessageSchema } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'
import { logger } from '@main/utils/logger'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'
import { handleInitConversationTitle } from './conversationTitleService'

export class ChatIpcService extends IpcService {
  static readonly groupName = 'chat'

  @IpcMethod()
  async createConversationsTitle(options: handleInitConversationTitleOptions): Promise<IpcResponse<IConversations>> {
    try {
      logger.info('IPC Event: chat:create-conversations-title', options)
      const title = await handleInitConversationTitle(options)
      const udpatedConversations = await getAppDataServices().conversationService.update({
        id: options.conversationsId,
        title,
      })
      return createIpcResponse(true, udpatedConversations)
    }
    catch (error) {
      logger.error('初始化会话标题失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getConversations(pageIndex: number, pageSize: number): Promise<IpcPaginatedResponse<IConversations[]>> {
    try {
      const workspaceStore = getAppDataServices().workspaceService
      const workspacePath = workspaceStore.getCurrentWorkspacePath()
      const includeNullWorkspace = workspacePath === workspaceStore.getDefaultWorkspacePath()
      const { data, total } = await getAppDataServices().conversationService.list(pageIndex, pageSize, workspacePath, includeNullWorkspace)
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
      const workspaceStore = getAppDataServices().workspaceService
      const includeNullWorkspace = workspacePath === workspaceStore.getDefaultWorkspacePath()
      const { data, total } = await getAppDataServices().conversationService.list(pageIndex, pageSize, workspacePath, includeNullWorkspace)
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
      const data = await getAppDataServices().conversationService.getById(id)
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
      const data = await getAppDataServices().conversationService.create({
        ...conversation,
        workspacePath: conversation.workspacePath ?? getAppDataServices().workspaceService.getCurrentWorkspacePath(),
      })
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
      const data = await getAppDataServices().conversationService.update(conversation)
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
      await getAppDataServices().conversationService.delete(id)
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
      const data = await getAppDataServices().messageService.listByConversation(id)
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
      const data = await getAppDataServices().messageService.getById(id)
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
      const data = await getAppDataServices().messageService.create(msg)
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
      const data = await getAppDataServices().messageService.update(msg)
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
      await getAppDataServices().messageService.delete(id)
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
      const { data, total } = await getAppDataServices().messageService.listByConversationPaginated(id, pageIndex, pageSize)
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
      await getAppDataServices().messageService.batchDelete(ids)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('批量删除消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }
}
