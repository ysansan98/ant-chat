import type { AttachmentSchema, ConversationsSchema, ConversationsSettingsSchema, LanguageModelUsage, McpToolCall, McpToolResult, MessageContent, ModelInfo } from '../schemas'

// 基础类型
export type MessageId = string
export type ConversationsId = string
export type ModelConfigId = 'Google' | 'Gemini' | 'OpenAI' | 'DeepSeek'
export type Timestamp = number
export type Role = 'system' | 'user' | 'assistant'

// 模型配置
export interface ModelConfig {
  id: string
  name?: string
  apiHost: string
  apiKey: string
  model: string
  temperature: number
}

// 会话设置
export type IConversationsSettings = ConversationsSettingsSchema

// 会话
export type IConversations = ConversationsSchema

// 附件
export type IAttachment = AttachmentSchema

// 图片
export type IImage = IAttachment

// MCP工具调用
export type IMcpToolCall = McpToolCall

// MCP工具结果
export type IMcpToolResult = McpToolResult

// 模型信息
export type IModelInfo = ModelInfo

// 消息基础接口
export interface IMessageBase {
  id: string
  convId: string
  createdAt: Timestamp
}

// 系统消息
export interface IMessageSystem extends IMessageBase {
  role: 'system'
  content: IMessageContent
  status: 'success'
}

// 用户消息
export interface IMessageUser extends IMessageBase {
  role: 'user'
  content: IMessageContent
  images: IAttachment[]
  attachments: IAttachment[]
  status: 'success'
}

// AI消息
export interface IMessageAI extends IMessageBase {
  role: 'assistant'
  reasoningContent?: string
  content: IMessageContent
  status: 'success' | 'error' | 'loading' | 'typing' | 'cancel'
  /** MCP 相关字段 */
  mcpTool?: IMcpToolCall[]
  /** 生成当前消息的模型信息 */
  modelInfo?: IModelInfo
  /** token usage for this message */
  usage?: LanguageModelUsage
}

export interface IMessage {
  id: MessageId
  convId: ConversationsId
  createdAt: Timestamp
  role: 'system' | 'user' | 'assistant'
  content: IMessageContent
  reasoningContent?: string
  status: 'success' | 'error' | 'loading' | 'typing' | 'cancel'
  images?: IAttachment[]
  attachments?: IAttachment[]
  /** MCP 相关字段 */
  mcpTool?: IMcpToolCall[]
  /** 生成当前消息的模型信息 */
  modelInfo?: IModelInfo
  /** token usage for this message */
  usage?: LanguageModelUsage
}

// 消息内容
export type IMessageContent = MessageContent

// MCP服务器状态
export type McpServerStatus = 'connected' | 'connecting' | 'disconnected'

export interface ChatFeatures {
  /** 联网搜索 */
  onlineSearch: boolean
  /** MCP */
  enableMCP: boolean
}
