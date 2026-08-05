import type { AgentMode, AgentTurnSource, CompactionSettingsSchema, IAIProvider, LoopMessage, ReasoningEffortLevel } from '@ant-chat/shared'
import type { ToolRegistry } from '../tools/toolRegistry'

export interface BeforeTurnResult {
  messages: LoopMessage[]
  systemPrompt?: string
  compacted?: boolean
}

export interface RuntimeStartInput {
  // ===== 标识 =====
  conversationId: string
  userMessageId: string
  workspacePath: string
  mode: AgentMode
  /** 用户文本内容的规范形式（所有 text block 拼接 trim） */
  userText: string

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

  // ===== 可选配置 =====
  /** 推理强度档位（ai-sdk v7 统一参数）。未设置时由厂商默认决定。 */
  reasoningEffort?: ReasoningEffortLevel
  compaction?: CompactionSettingsSchema

  /** 自动化/交互来源标记 */
  turnSource?: AgentTurnSource

  /** Turn 准备阶段已发生、待 recorder 创建后按序写入的上下文事实。 */
  preTurnContextEvents?: unknown[]

}

export interface RuntimeStartResult {
  taskId: string
}
