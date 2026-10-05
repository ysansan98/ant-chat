import type { ReasoningEffortLevel } from '../schemas/providerConfigModels'
import type { AgentMode, AgentTurnSource } from './agent-runtime'
import type { IMessageContent } from './db-types'
import type { AppPendingMessageSnapshot } from './pending-messages'

/**
 * App transport input for starting an agent turn.
 */
export interface StartAgentTurnOptions {
  /** 频道入站重试时复用已持久化的初始 user Message。 */
  userMessageId?: string
  conversationId?: string
  messageContent: IMessageContent
  turnSource?: AgentTurnSource
  workspacePath: string
  mode?: AgentMode
  /** 仅新建 conversation 时消费 */
  conversationInstructions?: string
  modelConfig: {
    modelId: string
    providerId: string
    reasoningEffort?: ReasoningEffortLevel
  }
}

export interface AgentTurnStartedResult {
  kind: 'started'
  taskId: string
  conversationId: string
  userMessageId: string
}

/**
 * 会话已有活跃任务时，本轮消息进入待处理队列，等任务终态后由后端接力发出。
 * snapshot 是该会话的最新队列快照，供客户端直接对账；userMessageId 在消息
 * 已持久化的来源（如频道入站）中存在，供回执关联。
 */
export interface AgentTurnQueuedResult {
  kind: 'queued'
  conversationId: string
  snapshot: AppPendingMessageSnapshot
  userMessageId?: string
}

/**
 * UserPromptSubmit hook 阻止本轮提交：turn 未启动，也没有消息入队。
 * 调用方应把 reason 直接展示给用户。
 */
export interface AgentTurnBlockedResult {
  kind: 'blocked'
  reason: string
  conversationId?: string
}

export type AgentTurnResult = AgentTurnStartedResult | AgentTurnQueuedResult | AgentTurnBlockedResult
