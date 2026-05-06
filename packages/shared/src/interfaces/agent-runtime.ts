import type { ToolOperationType, ToolScope } from './agent-tools'
import type { ChatFeatures, IAttachment, IConversations } from './db-types'
import type { ChatSettings } from './model-service'

export type AgentMode = 'strict' | 'hybrid' | 'full_managed'

export type AgentTaskStatus
  = | 'running'
    | 'awaiting_approval'
    | 'success'
    | 'failed'
    | 'cancelled'

export type AgentErrorCode
  = | 'AGENT_TASK_NOT_FOUND'
    | 'AGENT_TASK_ALREADY_RUNNING'
    | 'AGENT_TASK_NOT_APPROVABLE'
    | 'AGENT_APPROVAL_ACTION_MISMATCH'
    | 'AGENT_APPROVAL_TIMEOUT'
    | 'AGENT_POLICY_BLOCKED'
    | 'AGENT_TOOL_EXEC_FAILED'
    | 'AGENT_SKILL_INVALID'
    | 'AGENT_CANCELLED'

export interface AgentPendingAction {
  actionId: string
  toolName: string
  operationType: ToolOperationType
  scope: ToolScope
  inputPreview: string
  createdAt: number
}

export interface AgentTaskSnapshot {
  taskId: string
  conversationId: string
  userMessageId: string
  workspacePath: string
  mode: AgentMode
  status: AgentTaskStatus
  createdAt: number
  updatedAt: number
  checkpointPath: string
  logPath: string
  prompt: string
  pendingAction?: AgentPendingAction
  errorCode?: AgentErrorCode
  errorMessage?: string
  /** 上下文用量信息 */
  contextUsage?: {
    estimatedTokens: number
    contextWindow: number
    usagePercent: number
  }
  /** 最近一次压缩的时间戳 */
  lastCompactionAt?: number
}

export interface StartAgentTurnOptions {
  conversationId?: string
  prompt: string
  images?: IAttachment[]
  attachments?: IAttachment[]
  workspacePath?: string
  mode?: AgentMode
  chatSettings: Omit<ChatSettings, 'model' | 'features'> & {
    modelId: string
    features: ChatFeatures
  }
}

export interface AgentTurnResult {
  taskId: string
  conversationId: string
  userMessageId: string
  conversation: IConversations
}

export interface ApprovePendingActionOptions {
  taskId: string
  actionId: string
}

export interface RejectPendingActionOptions {
  taskId: string
  actionId: string
  reason?: string
}

export interface CancelTaskOptions {
  taskId: string
}
