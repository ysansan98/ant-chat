import type { ApprovalGrantCandidates } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { rebuildRulesFromApproval } from '../approvalRuleRebuilder'

describe('审批规则重建', () => {
  it('从浏览器审批候选保存用户调整后的域名限制', () => {
    const grant: ApprovalGrantCandidates = {
      candidates: [{
        type: 'browser',
        toolName: 'browser_navigate',
        urlPattern: 'github.com',
        riskWarning: '测试',
      }],
      context: {},
    }

    const rules = rebuildRulesFromApproval(grant, {
      selections: [{ candidateIndex: 0, adjustedUrlPattern: '*.github.com' }],
      scope: 'workspace',
    })

    expect(rules).toHaveLength(1)
    expect(rules[0]).toMatchObject({
      effect: 'allow',
      kind: 'browser',
      toolName: 'browser_navigate',
      urlPattern: '*.github.com',
    })
  })
})
