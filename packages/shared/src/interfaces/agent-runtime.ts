import type { ApprovalGrantCandidates } from '../schemas/toolApprovalRules'
import type { ToolOperationType, ToolScope } from './agent-tools'
import type { AutomationPermissionPolicy } from './automation'

export type AgentMode = 'strict' | 'hybrid' | 'full_managed'

export type AgentTurnSource
  = | { type: 'interactive' }
    | {
      type: 'automation'
      automationId: string
      runId: string
      allowedSkills: string[]
      allowedMcpServers: string[]
      permissionPolicy: AutomationPermissionPolicy
    }

export type AgentTaskStatus
  = | 'running'
    | 'awaiting_approval'
    | 'success'
    | 'failed'
    | 'cancelled'

export type AgentExecutionPhase
  = | 'waiting_model'
    | 'thinking'
    | 'generating_response'
    | 'preparing_tool'
    | 'using_tool'

export type AgentErrorCode
  = | 'AGENT_TASK_NOT_FOUND'
    | 'AGENT_TASK_ALREADY_RUNNING'
    | 'AGENT_TASK_NOT_APPROVABLE'
    | 'AGENT_APPROVAL_ACTION_MISMATCH'
    | 'AGENT_APPROVAL_TIMEOUT'
    | 'AGENT_POLICY_BLOCKED'
    | 'AGENT_TOOL_EXEC_FAILED'
    | 'AGENT_PROVIDER_NOT_FOUND'
    | 'AGENT_CANCELLED'

export const AGENT_POLICY_BLOCKED = 'AGENT_POLICY_BLOCKED'
export const AGENT_TOOL_EXEC_FAILED = 'AGENT_TOOL_EXEC_FAILED'

export interface AgentPendingAction {
  actionId: string
  toolName: string
  operationType: ToolOperationType
  scope: ToolScope
  inputPreview: string
  createdAt: number
  /** 后端构造的候选规则和重建上下文；用户审批时从快照重建并校验 */
  approvalCandidates?: ApprovalGrantCandidates
}

export interface AgentTaskSnapshot {
  taskId: string
  conversationId: string
  userMessageId: string
  workspacePath: string
  mode: AgentMode
  status: AgentTaskStatus
  /** 执行阶段；可选以兼容未带该字段的旧 runtime 快照。 */
  executionPhase?: AgentExecutionPhase
  createdAt: number
  updatedAt: number
  prompt: string
  turnSource?: AgentTurnSource
  pendingAction?: AgentPendingAction
  errorCode?: AgentErrorCode
  errorMessage?: string
  /** 任务执行摘要：成功时为 AI 最终回复，失败时为错误信息 */
  summary?: string
  /** 上下文用量信息 */
  contextUsage?: {
    estimatedTokens: number
    contextWindow: number
    usagePercent: number
  }
}

export interface ApprovePendingActionOptions {
  taskId: string
  actionId: string
  /** 用户对后端候选项的选择；空数组或 undefined = 仅本次允许，不持久化 */
  selection?: {
    selections: Array<{
      candidateIndex: number
      adjustedArgvPrefix?: string[]
      allowRemainingArgs?: boolean
      wholeExecutable?: boolean
      parentDirectory?: boolean
    }>
    scope: 'workspace' | 'global'
  }
}

export interface RejectPendingActionOptions {
  taskId: string
  actionId: string
  reason?: string
}

export interface CancelTaskOptions {
  taskId: string
}
