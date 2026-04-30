import type { ChatSettings } from './chat-service'

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

export interface AgentProgressItem {
  id: string
  title: string
  status: 'done' | 'running' | 'pending' | 'failed' | 'skipped'
}

export interface AgentPendingAction {
  actionId: string
  toolName: string
  riskLevel: 'L0' | 'L1' | 'L2'
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
  progress: AgentProgressItem[]
  pendingAction?: AgentPendingAction
  errorCode?: AgentErrorCode
  errorMessage?: string
}

export interface StartAgentTaskOptions {
  conversationId: string
  userMessageId: string
  prompt: string
  workspacePath?: string
  mode?: AgentMode
  chatSettings?: Omit<ChatSettings, 'model'> & { modelId: string }
}

export interface AgentTaskResult {
  taskId: string
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
