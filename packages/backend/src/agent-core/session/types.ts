import type { AgentMode, AgentTurnSource, CompactionSettingsSchema, IAIProvider, ITaskLogger, LoopMessage } from '@ant-chat/shared'
import type { ToolRegistry } from '../tools/toolRegistry'

/** 上下文诊断捕获回调类型 */
export type ContextTraceCaptureFn = (payload: Record<string, unknown>) => void

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

  /** 自动化/交互来源标记 */
  turnSource?: AgentTurnSource

  /** 上下文诊断捕获（开发环境使用，由 SessionRuntime 设置） */
  contextTraceCapture?: ContextTraceCaptureFn
}

export interface RuntimeStartResult {
  taskId: string
}
