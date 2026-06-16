import { describe, expect, it } from 'vitest'
import { decidePolicy } from '../policyEngine'

describe('decidePolicy 行为', () => {
  describe('full_managed 模式', () => {
    it('无论操作类型和 scope 都返回 allow', () => {
      expect(decidePolicy('full_managed', 'write', 'workspace')).toEqual({ type: 'allow' })
      expect(decidePolicy('full_managed', 'bash', 'outside')).toEqual({ type: 'allow' })
      expect(decidePolicy('full_managed', 'read', 'blocked')).toEqual({ type: 'allow' })
    })
  })

  describe('blocked scope 行为', () => {
    it('无论操作类型都阻断', () => {
      const result = decidePolicy('strict', 'read', 'blocked')
      expect(result.type).toBe('block')
      expect((result as { errorCode: string }).errorCode).toBe('AGENT_POLICY_BLOCKED')
    })
  })

  describe('outside scope 行为', () => {
    it('需要审批', () => {
      expect(decidePolicy('strict', 'read', 'outside')).toEqual({ type: 'require_approval' })
      expect(decidePolicy('hybrid', 'write', 'outside')).toEqual({ type: 'require_approval' })
    })
  })

  describe('workspace scope 行为', () => {
    it('允许 read 操作', () => {
      expect(decidePolicy('strict', 'read', 'workspace')).toEqual({ type: 'allow' })
    })

    it('允许 skill 操作', () => {
      expect(decidePolicy('strict', 'skill', 'workspace')).toEqual({ type: 'allow' })
    })

    it('允许 browser 操作', () => {
      expect(decidePolicy('strict', 'browser', 'workspace')).toEqual({ type: 'allow' })
      expect(decidePolicy('hybrid', 'browser', 'workspace')).toEqual({ type: 'allow' })
    })

    it('hybrid 模式允许 write 操作', () => {
      expect(decidePolicy('hybrid', 'write', 'workspace')).toEqual({ type: 'allow' })
    })

    it('strict 模式下 write 需要审批', () => {
      expect(decidePolicy('strict', 'write', 'workspace')).toEqual({ type: 'require_approval' })
    })

    it('hybrid 模式下 bash 需要审批', () => {
      expect(decidePolicy('hybrid', 'bash', 'workspace')).toEqual({ type: 'require_approval' })
    })

    it('strict 模式下 bash 需要审批', () => {
      expect(decidePolicy('strict', 'bash', 'workspace')).toEqual({ type: 'require_approval' })
    })
  })
})
