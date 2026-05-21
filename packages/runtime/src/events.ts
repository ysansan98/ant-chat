import type {
  AgentPendingAction,
  AgentTaskSnapshot,
  IAIStreamChunk,
  McpToolCall,
} from '@ant-chat/shared'

/**
 * RuntimeEvent — 所有运行时事件的联合类型。
 *
 * 对外暴露统一的事件类型，便于上层（适配器/UI）做类型收窄和分发。
 */
export type RuntimeEvent
  = | RuntimeTurnStartedEvent
    | RuntimeTurnChunkEvent
    | RuntimeToolCallsEvent
    | RuntimeTurnFinishedEvent
    | RuntimeTaskUpdatedEvent
    | RuntimeApprovalRequiredEvent

/** 每个 turn 开始 */
export interface RuntimeTurnStartedEvent {
  type: 'turn_started'
  conversationId: string
  model: {
    name: string
    provider: string
    providerId: string
  }
}

/** 模型流式输出的每个 chunk */
export interface RuntimeTurnChunkEvent {
  type: 'turn_chunk'
  conversationId: string
  accumulatedText: string
  chunk: IAIStreamChunk
}

/** 模型返回的工具调用列表 */
export interface RuntimeToolCallsEvent {
  type: 'tool_calls'
  conversationId: string
  text: string
  toolCalls: McpToolCall[]
}

/** 每个 turn 结束（success / error / cancel） */
export interface RuntimeTurnFinishedEvent {
  type: 'turn_finished'
  conversationId: string
  text: string
  status: 'success' | 'error' | 'cancel'
}

/** 任务快照更新 */
export interface RuntimeTaskUpdatedEvent {
  type: 'task_updated'
  task: AgentTaskSnapshot
}

/** 需要审批的待处理操作 */
export interface RuntimeApprovalRequiredEvent {
  type: 'approval_required'
  taskId: string
  conversationId: string
  pendingAction: AgentPendingAction
}
