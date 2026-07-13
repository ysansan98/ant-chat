import type { AttachmentSchema, ConversationsSchema, ConversationsSettingsSchema, LanguageModelUsage, MessageContent, ModelInfo } from '../schemas'

// 基础类型
export type MessageId = string
export type ConversationsId = string
export type ModelConfigId = 'Google' | 'Gemini' | 'OpenAI' | 'DeepSeek'
export type Timestamp = number
export type Role = 'user' | 'assistant' | 'tool' | 'event'

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

// 模型信息
export type IModelInfo = ModelInfo

// 消息基础接口
export interface IMessageBase {
  id: string
  convId: string
  createdAt: Timestamp
  turnId?: string
}

// 用户消息
export interface IMessageUser extends IMessageBase {
  role: 'user'
  content: IMessageContent
  status: 'success'
}

// AI消息
export interface IMessageAI extends IMessageBase {
  role: 'assistant'
  reasoningContent?: string
  content: IMessageContent
  status: 'success' | 'error' | 'loading' | 'typing' | 'cancel'
  /** 生成当前消息的模型信息 */
  modelInfo?: IModelInfo
  /** token usage for this message */
  usage?: LanguageModelUsage
  /** 任务总耗时（毫秒），仅最终态持久化 */
  durationMs?: number
}

// Tool 消息（工具执行结果）
export interface IMessageTool extends IMessageBase {
  role: 'tool'
  content: IMessageContent
  status: 'success' | 'error'
}

// 事件消息（压缩、记忆等系统事件）
export interface IMessageEvent extends IMessageBase {
  role: 'event'
  content: IMessageContent
  status: 'success' | 'loading' | 'error'
  eventType: string
  modelInfo?: IModelInfo
  usage?: LanguageModelUsage
  compactedThroughMessageId?: string
}

export interface IMessage {
  id: MessageId
  convId: ConversationsId
  createdAt: Timestamp
  role: Role
  content: IMessageContent
  reasoningContent?: string
  status: 'success' | 'error' | 'loading' | 'typing' | 'cancel'
  /** 生成当前消息的模型信息 */
  modelInfo?: IModelInfo
  /** token usage for this message */
  usage?: LanguageModelUsage
  /** 任务总耗时（毫秒），仅 assistant 消息的最终态持久化 */
  durationMs?: number
  /** 事件类型（role 为 'event' 时） */
  eventType?: string
  /** 所属 turn 的用户消息 id */
  turnId?: string
  /** Last persisted message represented by a compaction summary. */
  compactedThroughMessageId?: string
}

// 消息内容
export type IMessageContent = MessageContent

// MCP服务器状态
export type McpServerStatus = 'connected' | 'connecting' | 'disconnected'
