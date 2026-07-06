import type { AgentErrorCode, AgentMode, ToolOperationType, ToolScope } from '@ant-chat/shared'

export type PolicyDecision
  = | { type: 'allow' }
    | { type: 'require_approval' }
    | { type: 'block', errorCode: AgentErrorCode, reason: string }

export function decidePolicy(mode: AgentMode, operationType: ToolOperationType, scope: ToolScope): PolicyDecision {
  if (mode === 'full_managed') {
    return { type: 'allow' }
  }

  if (scope === 'blocked') {
    return { type: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: '策略阻断，禁止执行' }
  }

  if (scope === 'outside') {
    return { type: 'require_approval' }
  }

  // scope === 'workspace'
  if (operationType === 'read' || operationType === 'browser' || operationType === 'skill' || operationType === 'mcp' || operationType === 'app') {
    return { type: 'allow' }
  }

  if (mode === 'hybrid' && operationType === 'write') {
    return { type: 'allow' }
  }

  return { type: 'require_approval' }
}
