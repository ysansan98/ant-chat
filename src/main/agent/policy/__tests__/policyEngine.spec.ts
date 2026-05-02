import { describe, expect, it } from 'vitest'
import { decidePolicy } from '../policyEngine'

describe('policyEngine', () => {
  describe('strict mode', () => {
    it('workspace read/skill → allow', () => {
      expect(decidePolicy('strict', 'read', 'workspace')).toEqual({ type: 'allow' })
      expect(decidePolicy('strict', 'skill', 'workspace')).toEqual({ type: 'allow' })
    })

    it('workspace write/bash → require_approval', () => {
      expect(decidePolicy('strict', 'write', 'workspace')).toEqual({ type: 'require_approval' })
      expect(decidePolicy('strict', 'bash', 'workspace')).toEqual({ type: 'require_approval' })
    })

    it('outside → require_approval', () => {
      expect(decidePolicy('strict', 'read', 'outside')).toEqual({ type: 'require_approval' })
      expect(decidePolicy('strict', 'write', 'outside')).toEqual({ type: 'require_approval' })
      expect(decidePolicy('strict', 'bash', 'outside')).toEqual({ type: 'require_approval' })
    })

    it('blocked → block', () => {
      expect(decidePolicy('strict', 'bash', 'blocked')).toEqual({
        type: 'block',
        errorCode: 'AGENT_POLICY_BLOCKED',
        reason: '策略阻断，禁止执行',
      })
    })
  })

  describe('hybrid mode', () => {
    it('workspace read/skill + write → allow', () => {
      expect(decidePolicy('hybrid', 'read', 'workspace')).toEqual({ type: 'allow' })
      expect(decidePolicy('hybrid', 'skill', 'workspace')).toEqual({ type: 'allow' })
      expect(decidePolicy('hybrid', 'write', 'workspace')).toEqual({ type: 'allow' })
    })

    it('workspace bash → require_approval', () => {
      expect(decidePolicy('hybrid', 'bash', 'workspace')).toEqual({ type: 'require_approval' })
    })

    it('outside → require_approval', () => {
      expect(decidePolicy('hybrid', 'read', 'outside')).toEqual({ type: 'require_approval' })
      expect(decidePolicy('hybrid', 'write', 'outside')).toEqual({ type: 'require_approval' })
    })

    it('blocked → block', () => {
      expect(decidePolicy('hybrid', 'bash', 'blocked')).toEqual({
        type: 'block',
        errorCode: 'AGENT_POLICY_BLOCKED',
        reason: '策略阻断，禁止执行',
      })
    })
  })

  describe('full_managed mode', () => {
    it('all scopes → allow', () => {
      expect(decidePolicy('full_managed', 'read', 'workspace')).toEqual({ type: 'allow' })
      expect(decidePolicy('full_managed', 'write', 'outside')).toEqual({ type: 'allow' })
      expect(decidePolicy('full_managed', 'bash', 'blocked')).toEqual({ type: 'allow' })
    })
  })
})
