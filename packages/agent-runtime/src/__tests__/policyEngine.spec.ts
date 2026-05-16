import { describe, expect, it } from 'vitest'
import { decidePolicy } from '../policyEngine'

describe('decidePolicy', () => {
  describe('full_managed mode', () => {
    it('always returns allow regardless of operation or scope', () => {
      expect(decidePolicy('full_managed', 'write', 'workspace')).toEqual({ type: 'allow' })
      expect(decidePolicy('full_managed', 'bash', 'outside')).toEqual({ type: 'allow' })
      expect(decidePolicy('full_managed', 'read', 'blocked')).toEqual({ type: 'allow' })
    })
  })

  describe('blocked scope', () => {
    it('blocks regardless of operation type', () => {
      const result = decidePolicy('strict', 'read', 'blocked')
      expect(result.type).toBe('block')
      expect((result as { errorCode: string }).errorCode).toBe('AGENT_POLICY_BLOCKED')
    })
  })

  describe('outside scope', () => {
    it('requires approval', () => {
      expect(decidePolicy('strict', 'read', 'outside')).toEqual({ type: 'require_approval' })
      expect(decidePolicy('hybrid', 'write', 'outside')).toEqual({ type: 'require_approval' })
    })
  })

  describe('workspace scope', () => {
    it('allows read operations', () => {
      expect(decidePolicy('strict', 'read', 'workspace')).toEqual({ type: 'allow' })
    })

    it('allows skill operations', () => {
      expect(decidePolicy('strict', 'skill', 'workspace')).toEqual({ type: 'allow' })
    })

    it('allows write in hybrid mode', () => {
      expect(decidePolicy('hybrid', 'write', 'workspace')).toEqual({ type: 'allow' })
    })

    it('requires approval for write in strict mode', () => {
      expect(decidePolicy('strict', 'write', 'workspace')).toEqual({ type: 'require_approval' })
    })

    it('requires approval for bash in hybrid mode', () => {
      expect(decidePolicy('hybrid', 'bash', 'workspace')).toEqual({ type: 'require_approval' })
    })

    it('requires approval for bash in strict mode', () => {
      expect(decidePolicy('strict', 'bash', 'workspace')).toEqual({ type: 'require_approval' })
    })
  })
})
