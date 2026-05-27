import type { AgentMode, CompactionSettingsSchema, IAIProvider, ITaskLogger, LoopMessage } from '@ant-chat/shared'
import type { ToolRegistry } from '../tools/toolRegistry'

export interface RuntimeStartInput {
  // ===== 标识 =====
  conversationId: string
  userMessageId: string
  workspacePath: string
  mode: AgentMode
  prompt: string

  // ===== 数据（外部预构建，纯数据传入）=====
  messages: LoopMessage[]
  systemPrompt: string
  registry: ToolRegistry

  // ===== 能力（外部创建，可调用实例传入）=====
  aiProvider: IAIProvider | null

  // ===== 元数据（日志/事件用，非业务逻辑）=====
  modelName: string
  providerName: string
  providerId: string
  apiMode: string

  // ===== 按任务日志 =====
  taskLogger?: ITaskLogger

  // ===== 可选配置 =====
  temperature?: number
  maxTokens?: number
  compaction?: CompactionSettingsSchema
}

export interface RuntimeStartResult {
  taskId: string
}
