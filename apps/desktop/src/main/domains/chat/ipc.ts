import type { AddConversationsSchema, handleInitConversationTitleOptions, IConversations, IMessage, IpcPaginatedResponse, IpcResponse, UpdateConversationsSchema } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcPaginatedResponse } from '@ant-chat/shared'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { normalizeIpcError, withIpcResponse } from '@main/utils/ipc-response'
import { logger } from '@main/utils/logger'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class ChatIpcService extends IpcService {
  static readonly groupName = 'chat'

  @IpcMethod()
  async createConversationsTitle(options: handleInitConversationTitleOptions): Promise<IpcResponse<IConversations>> {
    return withIpcResponse(
      () => getAppRuntime().chat.createConversationTitle(options.conversationsId, options.modelId),
      '初始化会话标题失败',
    )
  }

  // 分页接口返回 IpcPaginatedResponse（带 total），类型与普通 IpcResponse 不同，保留手写包装。
  @IpcMethod()
  async getConversations(pageIndex: number, pageSize: number): Promise<IpcPaginatedResponse<IConversations[]>> {
    try {
      const { data, total } = await getAppRuntime().chat.listConversations(pageIndex, pageSize)
      return createIpcPaginatedResponse(true, data, '', total)
    }
    catch (error) {
      const normalized = normalizeIpcError(error)
      logger.error('获取会话列表失败:', normalized)
      return createErrorIpcResponse(normalized)
    }
  }

  @IpcMethod()
  async getWorkspaceConversations(workspacePath: string, pageIndex: number, pageSize: number): Promise<IpcPaginatedResponse<IConversations[]>> {
    try {
      const { data, total } = await getAppRuntime().chat.listConversations(pageIndex, pageSize, workspacePath)
      return createIpcPaginatedResponse(true, data, '', total)
    }
    catch (error) {
      const normalized = normalizeIpcError(error)
      logger.error('获取工作区会话列表失败:', normalized)
      return createErrorIpcResponse(normalized)
    }
  }

  @IpcMethod()
  async getConversationById(id: string): Promise<IpcResponse<IConversations>> {
    return withIpcResponse(() => getAppRuntime().chat.getConversation(id), '获取会话详情失败')
  }

  @IpcMethod()
  async addConversation(conversation: AddConversationsSchema): Promise<IpcResponse<IConversations>> {
    return withIpcResponse(() => getAppRuntime().chat.createConversation(conversation), '添加会话失败')
  }

  @IpcMethod()
  async updateConversation(conversation: UpdateConversationsSchema): Promise<IpcResponse<IConversations>> {
    return withIpcResponse(() => getAppRuntime().chat.updateConversation(conversation), '更新会话失败')
  }

  @IpcMethod()
  async deleteConversation(id: string): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().chat.deleteConversation(id), '删除会话失败')
  }

  @IpcMethod()
  async clearWorkspaceConversations(workspacePath: string): Promise<IpcResponse<string[]>> {
    return withIpcResponse(() => getAppRuntime().chat.clearWorkspaceConversations(workspacePath), '清空工作区会话失败')
  }

  @IpcMethod()
  async getMessagesByConvId(id: string): Promise<IpcResponse<IMessage[]>> {
    return withIpcResponse(() => getAppRuntime().chat.listMessages(id), '获取消息失败')
  }

  @IpcMethod()
  async getMessageById(id: string): Promise<IpcResponse<IMessage>> {
    return withIpcResponse(() => getAppRuntime().chat.getMessage(id), '获取消息失败')
  }

  @IpcMethod()
  async addMessage(message: IMessage): Promise<IpcResponse<IMessage>> {
    return withIpcResponse(() => getAppRuntime().chat.createMessage(message), '添加消息失败')
  }

  @IpcMethod()
  async updateMessage(message: IMessage): Promise<IpcResponse<IMessage>> {
    return withIpcResponse(() => getAppRuntime().chat.updateMessage(message), '更新消息失败')
  }

  @IpcMethod()
  async deleteMessage(id: string): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().chat.deleteMessage(id), '删除消息失败')
  }

  @IpcMethod()
  async batchDeleteMessages(ids: string[]): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().chat.batchDeleteMessages(ids), '批量删除消息失败')
  }
}
