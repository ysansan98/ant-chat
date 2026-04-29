import { describe, expect, it } from 'vitest'
import { decidePolicy } from '../policyEngine'

describe('policyEngine', () => {
  it('strict 模式全部 require_approval', () => {
    expect(decidePolicy('strict', 'L0')).toEqual({ type: 'require_approval' })
    expect(decidePolicy('strict', 'L1')).toEqual({ type: 'require_approval' })
    expect(decidePolicy('strict', 'L2')).toEqual({ type: 'require_approval' })
  })

  it('hybrid 模式 L0 allow，L1/L2 require_approval', () => {
    expect(decidePolicy('hybrid', 'L0')).toEqual({ type: 'allow' })
    expect(decidePolicy('hybrid', 'L1')).toEqual({ type: 'require_approval' })
    expect(decidePolicy('hybrid', 'L2')).toEqual({ type: 'require_approval' })
  })

  it('full_managed 模式允许非阻断动作', () => {
    expect(decidePolicy('full_managed', 'L0')).toEqual({ type: 'allow' })
    expect(decidePolicy('full_managed', 'L1')).toEqual({ type: 'allow' })
    expect(decidePolicy('full_managed', 'L2')).toEqual({ type: 'allow' })
  })

  it('硬阻断返回 block', () => {
    expect(decidePolicy('full_managed', 'L0', 'AGENT_POLICY_BLOCKED')).toEqual({
      type: 'block',
      errorCode: 'AGENT_POLICY_BLOCKED',
      reason: '策略阻断，禁止执行',
    })
  })
})
