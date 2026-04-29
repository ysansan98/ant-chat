import type { AgentErrorCode, AgentMode, AgentToolRisk } from '@ant-chat/shared'

export type PolicyDecision
  = | { type: 'allow' }
    | { type: 'require_approval' }
    | { type: 'block', errorCode: AgentErrorCode, reason: string }

export function decidePolicy(mode: AgentMode, riskLevel: AgentToolRisk, toolError?: string): PolicyDecision {
  if (toolError === 'AGENT_POLICY_BLOCKED') {
    return { type: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: '策略阻断，禁止执行' }
  }

  if (mode === 'strict') {
    return { type: 'require_approval' }
  }

  if (mode === 'hybrid') {
    return riskLevel === 'L0' ? { type: 'allow' } : { type: 'require_approval' }
  }

  return { type: 'allow' }
}
