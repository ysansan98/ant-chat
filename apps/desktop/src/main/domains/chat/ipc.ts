import type { AddConversationsSchema, handleInitConversationTitleOptions, IConversations, IMessage, IpcPaginatedResponse, IpcResponse, UpdateConversationsSchema } from '@ant-chat/shared'
import { createConversationTitleService } from '@ant-chat/agent-runtime'
import { AddMessage, createErrorIpcResponse, createIpcPaginatedResponse, createIpcResponse, UpdateMessageSchema } from '@ant-chat/shared'
import { getAgentRuntimeEnvironment } from '@main/agent/runtime/agentRuntimeEnvironment'
import { logger } from '@main/utils/logger'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class ChatIpcService extends IpcService {
  static readonly groupName = 'chat'

  @IpcMethod()
  async createConversationsTitle(options: handleInitConversationTitleOptions): Promise<IpcResponse<IConversations>> {
    try {
      logger.info('IPC Event: chat:create-conversations-title', options)
      const env = getAgentRuntimeEnvironment()
      const titleService = createConversationTitleService({
        providerSettingsRepository: env.appDataServices.providerSettingsRepository,
        messageService: env.appDataServices.messageService,
        conversationService: env.appDataServices.conversationService,
      })
      const updatedConversations = await titleService.updateTitle(options.conversationsId, options.modelId)
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
      const workspaceStore = getAgentRuntimeEnvironment().appDataServices.workspaceService
      const workspacePath = workspaceStore.getCurrentWorkspacePath()
      const includeNullWorkspace = workspacePath === workspaceStore.getDefaultWorkspacePath()
      const { data, total } = await getAgentRuntimeEnvironment().appDataServices.conversationService.list(pageIndex, pageSize, workspacePath, includeNullWorkspace)
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
      const workspaceStore = getAgentRuntimeEnvironment().appDataServices.workspaceService
      const includeNullWorkspace = workspacePath === workspaceStore.getDefaultWorkspacePath()
      const { data, total } = await getAgentRuntimeEnvironment().appDataServices.conversationService.list(pageIndex, pageSize, workspacePath, includeNullWorkspace)
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
      const data = await getAgentRuntimeEnvironment().appDataServices.conversationService.getById(id)
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
      const data = await getAgentRuntimeEnvironment().appDataServices.conversationService.create({
        ...conversation,
        workspacePath: conversation.workspacePath ?? getAgentRuntimeEnvironment().appDataServices.workspaceService.getCurrentWorkspacePath(),
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
      const data = await getAgentRuntimeEnvironment().appDataServices.conversationService.update(conversation)
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
      await getAgentRuntimeEnvironment().appDataServices.conversationService.delete(id)
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
      const data = await getAgentRuntimeEnvironment().appDataServices.messageService.listByConversation(id)
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
      const data = await getAgentRuntimeEnvironment().appDataServices.messageService.getById(id)
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
      const data = await getAgentRuntimeEnvironment().appDataServices.messageService.create(msg)
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
      const data = await getAgentRuntimeEnvironment().appDataServices.messageService.update(msg)
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
      await getAgentRuntimeEnvironment().appDataServices.messageService.delete(id)
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
      const { data, total } = await getAgentRuntimeEnvironment().appDataServices.messageService.listByConversationPaginated(id, pageIndex, pageSize)
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
      await getAgentRuntimeEnvironment().appDataServices.messageService.batchDelete(ids)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('批量删除消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }
}
