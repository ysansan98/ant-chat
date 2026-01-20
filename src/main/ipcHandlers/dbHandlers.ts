import type {
  UpdateServiceProviderSchema,
} from '@ant-chat/shared'
import {
  AddMessage,
  createErrorIpcResponse,
  createIpcPaginatedResponse,
  createIpcResponse,
  UpdateMessageSchema,
} from '@ant-chat/shared'
import { services } from '../db'
import { mainListener } from '../utils/ipc-events-bus'
import { logger } from '../utils/logger'

// 注册所有数据库操作的IPC处理函数
export function registerDbHandlers() {
  // ============================ 会话操作 ============================
  mainListener.handle('db:get-conversations', async (_e, pageIndex, pageSize) => {
    try {
      const total = await services.getConversationsTotal()
      const data = await services.getConversations(pageIndex, pageSize)
      return createIpcPaginatedResponse(true, data, '', total)
    }
    catch (error) {
      logger.error('获取会话列表失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:conversations-is-exists', async (__dirname, id) => {
    const success = await services.conversationsIsExists(id)
    return createIpcResponse(success, null)
  })

  mainListener.handle('db:get-conversation-by-id', async (_, id) => {
    try {
      const data = await services.getConversationById(id)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('获取会话详情失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:add-conversation', async (_, conversation) => {
    try {
      const data = await services.addConversation(conversation)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('添加会话失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:update-conversation', async (_, conversation) => {
    try {
      const data = await services.updateConversation(conversation)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('更新会话失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:delete-conversation', async (_, id) => {
    try {
      await services.deleteConversation(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('删除会话失败:', error)
      return createErrorIpcResponse((error as Error))
    }
  })

  // ============================ 消息操作 ============================
  mainListener.handle('db:get-message-by-convid', async (_, id) => {
    try {
      const data = await services.getMessagesByConvId(id)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('获取消息失败:', error)
      return createErrorIpcResponse((error as Error))
    }
  })

  mainListener.handle('db:get-message-by-id', async (_, id) => {
    try {
      const data = await services.getMessageById(id)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('获取消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:add-message', async (_, message) => {
    try {
      const msg = AddMessage.parse(message)
      const data = await services.addMessage(msg)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('添加消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:update-message', async (_, message) => {
    try {
      const msg = UpdateMessageSchema.parse(message)
      const data = await services.updateMessage(msg)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('更新消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:delete-message', async (_, id) => {
    try {
      await services.deleteMessage(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('删除消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:get-messages-by-conv-id-with-pagination', async (_, id, pageIndex, pageSize) => {
    try {
      const { data, total } = await services.getMessagesByConvIdWithPagination(id, pageIndex, pageSize)
      return createIpcPaginatedResponse(true, data, '', total)
    }
    catch (error) {
      logger.error(`分页获取会话消息失败. convId: ${id}`, error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:batch-delete-messages', async (_, ids) => {
    try {
      await services.batchDeleteMessages(ids)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('批量删除消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  // ============================ MCP配置操作 ============================
  mainListener.handle('db:get-mcp-configs', async () => {
    try {
      const data = await services.getMcpConfigs()
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('获取MCP配置失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:get-mcp-config-by-server-name', async (_, serverName) => {
    try {
      const data = await services.getMcpConfigByServerName(serverName)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('获取MCP配置详情失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:add-mcp-config', async (_, config) => {
    try {
      const data = await services.addMcpConfig(config)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('添加MCP配置失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:update-mcp-config', async (_, config) => {
    try {
      const data = await services.updateMcpConfig(config)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('更新MCP配置失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:delete-mcp-config', async (_, serverName) => {
    try {
      await services.deleteMcpConfig(serverName)
      return createIpcResponse(true, null)
    }
    catch (error) {
      logger.error('删除MCP配置失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })

  // ============================ AI提供商相关 ============================
  mainListener.handle('db:get-all-provider-services', async (_) => {
    try {
      const data = services.getAllProviderServices()
      return createIpcResponse(true, data)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:update-provider-service', async (_, serviceData: UpdateServiceProviderSchema) => {
    try {
      const updatedData = services.updateProviderService(serviceData)
      return createIpcResponse(true, updatedData)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  // 新增 Provider Service
  mainListener.handle('db:add-provider-services', async (_, data) => {
    try {
      const result = services.addProviderService(data)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  // 删除 Provider Service
  mainListener.handle('db:delete-provider-service', async (_, id) => {
    try {
      await services.deleteProviderService(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  // 根据 ID 获取 Provider Service
  mainListener.handle('db:get-provider-services-by-id', async (_, id) => {
    try {
      const result = services.getProviderServiceById(id)

      if (!result) {
        return createErrorIpcResponse(new Error('not found'))
      }
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  // 获取所有可用模型
  mainListener.handle('db:get-all-abvailable-models', async () => {
    try {
      const result = await services.getAllAvailableModels()
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  // 根据 Provider Service ID 获取模型
  mainListener.handle('db:get-models-by-provider-service-id', async (_, id) => {
    try {
      const result = await services.getModelsByServiceProviderId(id)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:get-model-by-id', async (_, id) => {
    try {
      const result = await services.getModelById(id)
      if (!result) {
        throw new Error('not found')
      }
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:get-provider-service-by-model-id', async (_, id) => {
    try {
      const result = services.getServiceProviderByModelId(id)
      if (!result) {
        throw new Error('not found')
      }
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  // 设置模型启用状态
  mainListener.handle('db:set-model-enabled-status', async (_, id, status) => {
    try {
      const result = await services.setModelEnabledStatus(id, status)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:add-provider-service-model', async (_, config) => {
    try {
      const result = await services.addServiceProviderModel(config)
      return createIpcResponse(true, result)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  mainListener.handle('db:delete-provider-service-model', async (_, id) => {
    try {
      await services.deleteServiceProviderModel(id)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  })

  // ============================ 全局搜索 ============================

  mainListener.handle('db:search-by-keyword', async (_, query) => {
    try {
      const data = await services.searchMessagesByKeyword(query)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('全局搜索消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  })
}
