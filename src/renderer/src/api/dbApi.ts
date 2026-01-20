import type { IMessage } from '@ant-chat/shared'
import type { AddConversationsSchema, AddMcpConfigSchema, AddServiceProviderModelSchema, AddServiceProviderSchema, UpdateConversationsSchema, UpdateMcpConfigSchema, UpdateServiceProviderSchema } from '@ant-chat/shared/src/schemas'
import { emitter, unwrapIpcPaginatedResponse, unwrapIpcResponse } from '@/utils/ipc-bus'

/**
 * 数据库操作 API
 * 使用 IPC 与主进程通信进行数据库操作
 */
export const dbApi = {
  // 会话操作
  getConversations: async (pageIndex: number, pageSize: number) => {
    return unwrapIpcPaginatedResponse(await emitter.invoke('db:get-conversations', pageIndex, pageSize))
  },

  conversationsExists: async (id: string) => {
    return unwrapIpcResponse(await emitter.invoke('db:conversations-is-exists', id))
  },

  getConversationById: async (id: string) => {
    return unwrapIpcResponse(await emitter.invoke('db:get-conversation-by-id', id))
  },

  addConversation: async (conversation: AddConversationsSchema) => {
    return unwrapIpcResponse(await emitter.invoke('db:add-conversation', conversation))
  },

  updateConversation: async (conversation: UpdateConversationsSchema) => {
    return unwrapIpcResponse(await emitter.invoke('db:update-conversation', conversation))
  },

  deleteConversation: async (id: string) => {
    return unwrapIpcResponse(await emitter.invoke('db:delete-conversation', id))
  },

  // 消息操作
  getMessagesByConvId: async (convId: string) => {
    return unwrapIpcResponse(await emitter.invoke('db:get-message-by-convid', convId))
  },

  getMessageById: async (id: string) => {
    return unwrapIpcResponse(await emitter.invoke('db:get-message-by-id', id))
  },

  addMessage: async (message: IMessage) => {
    return unwrapIpcResponse(await emitter.invoke('db:add-message', message))
  },

  updateMessage: async (message: IMessage) => {
    return unwrapIpcResponse(await emitter.invoke('db:update-message', message))
  },

  deleteMessage: async (id: string) => {
    return unwrapIpcResponse(await emitter.invoke('db:delete-message', id))
  },

  getMessagesByConvIdWithPagination: async (id: string, pageIndex: number, pageSize: number) => {
    return unwrapIpcPaginatedResponse(
      await emitter.invoke(
        'db:get-messages-by-conv-id-with-pagination',
        id,
        pageIndex,
        pageSize,
      ),
    )
  },

  batchDeleteMessages: async (ids: string[]) => {
    return unwrapIpcResponse(await emitter.invoke('db:batch-delete-messages', ids))
  },

  // MCP配置操作
  getMcpConfigs: async () => {
    return unwrapIpcResponse(await emitter.invoke('db:get-mcp-configs'))
  },

  getMcpConfigByServerName: async (serverName: string) => {
    return unwrapIpcResponse(await emitter.invoke('db:get-mcp-config-by-server-name', serverName))
  },

  addMcpConfig: async (config: AddMcpConfigSchema) => {
    return unwrapIpcResponse(await emitter.invoke('db:add-mcp-config', config))
  },

  updateMcpConfig: async (config: UpdateMcpConfigSchema) => {
    return unwrapIpcResponse(await emitter.invoke('db:update-mcp-config', config))
  },

  deleteMcpConfig: async (serverName: string) => {
    return unwrapIpcResponse(await emitter.invoke('db:delete-mcp-config', serverName))
  },

  // ============================ AI 提供商相关 ============================
  async getAllProviderServices() {
    return unwrapIpcResponse(await emitter.invoke('db:get-all-provider-services'))
  },

  async AddServiceProvider(config: AddServiceProviderSchema) {
    return unwrapIpcResponse(await emitter.invoke('db:add-provider-services', config))
  },

  async updateServiceProvider(config: UpdateServiceProviderSchema) {
    return unwrapIpcResponse(await emitter.invoke('db:update-provider-service', config))
  },

  async deleteServiceProvider(id: string) {
    return unwrapIpcResponse(await emitter.invoke('db:delete-provider-service', id))
  },

  async getServiceProviderById(id: string) {
    return unwrapIpcResponse(await emitter.invoke('db:get-provider-services-by-id', id))
  },

  async getServiceProviderByModelId(id: string) {
    return unwrapIpcResponse(await emitter.invoke('db:get-provider-service-by-model-id', id))
  },

  // ============================ 模型 ============================
  async getAllAbvailableModels() {
    return unwrapIpcResponse(await emitter.invoke('db:get-all-abvailable-models'))
  },
  async getModelsByServiceProviderId(id: string) {
    return unwrapIpcResponse(await emitter.invoke('db:get-models-by-provider-service-id', id))
  },

  async setModelEnabledStatus(id: string, status: boolean) {
    return unwrapIpcResponse(await emitter.invoke('db:set-model-enabled-status', id, status))
  },

  async addServiceProviderModel(config: AddServiceProviderModelSchema) {
    return unwrapIpcResponse(await emitter.invoke('db:add-provider-service-model', config))
  },

  async deleteServiceProviderModel(id: string) {
    return unwrapIpcResponse(await emitter.invoke('db:delete-provider-service-model', id))
  },

  async getModelInfoById(id: string) {
    return unwrapIpcResponse(await emitter.invoke('db:get-model-by-id', id))
  },

  // ============================ 搜索相关 ============================
  async searchByKeyword(keyword: string) {
    return unwrapIpcResponse(
      await emitter.invoke('db:search-by-keyword', keyword),
    )
  },
}
