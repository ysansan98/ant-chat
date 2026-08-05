import type { AgentObservabilityEvidence, AgentObservabilityRecord, AgentTurnTimelineItem, TraceSpanKind, TraceSpanStatus } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { agentModeLabel, parseEvidence, policyBasisLabel, spanStatusLabel } from './evidenceModel'

describe('parseEvidence · model-request', () => {
  it('解析完整请求与响应：模型设置、消息、工具、usage、工具调用', () => {
    const view = parseEvidence(spanItem('model-request'), evidence(
      spanStarted('model-request', {
        messages: [
          { role: 'user', content: [{ type: 'text', text: '你好' }] },
          { role: 'assistant', content: [{ type: 'text', text: '您好' }, { type: 'tool-call', toolCallId: 'c1', toolName: 'read', args: { path: '/a' } }] },
          { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'read', result: '文件内容' }] },
        ],
        modelSettings: { model: 'gpt-4o', systemPrompt: '你是助手', reasoningEffort: 'high' },
        tools: [{ name: 'read', serverName: 'native', description: '读取文件', inputSchema: { type: 'object', properties: {}, required: [] } }],
      }),
      spanCompleted('model-request', 'success', {
        text: '最终回复',
        durationMs: 2100,
        usage: { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
        finishReason: 'tool-calls',
        toolCalls: [{ id: 'c2', toolName: 'write', input: { path: '/b' } }],
      }),
    ))

    expect(view.type).toBe('model-request')
    if (view.type !== 'model-request')
      return
    expect(view.model).toBe('gpt-4o')
    expect(view.reasoningEffort).toBe('high')
    expect(view.systemPrompt).toBe('你是助手')
    expect(view.messages).toHaveLength(3)
    expect(view.messages[1].blocks[1]).toMatchObject({ type: 'tool-call', toolName: 'read' })
    expect(view.messages[2].blocks[0]).toMatchObject({ type: 'tool-result', toolName: 'read', result: '文件内容' })
    expect(view.tools).toEqual([expect.objectContaining({ name: 'read', serverName: 'native' })])
    expect(view.responseText).toBe('最终回复')
    expect(view.usage).toMatchObject({ inputTokens: 1200, outputTokens: 300 })
    expect(view.finishReason).toBe('tool-calls')
    expect(view.toolCalls).toEqual([expect.objectContaining({ toolName: 'write' })])
    expect(view.pending).toBe(false)
  })

  it('容忍 content 为字符串的消息', () => {
    const view = parseEvidence(spanItem('model-request'), evidence(
      spanStarted('model-request', { messages: [{ role: 'user', content: '真实请求' }] }),
    ))
    expect(view.type).toBe('model-request')
    if (view.type !== 'model-request')
      return
    expect(view.messages).toEqual([{ role: 'user', blocks: [{ type: 'text', text: '真实请求' }] }])
  })

  it('模型失败时从脱敏 Error 对象提取 message', () => {
    const view = parseEvidence(spanItem('model-request', 'failed'), evidence(
      spanStarted('model-request', { messages: [] }),
      spanCompleted('model-request', 'failed', undefined, { name: 'Error', message: '网络超时', stack: 'at ...' }),
    ))
    expect(view.type).toBe('model-request')
    if (view.type !== 'model-request')
      return
    expect(view.errorText).toBe('网络超时')
    expect(view.errorRaw).toMatchObject({ name: 'Error' })
    expect(view.pending).toBe(false)
  })

  it('provider 错误缺失 message 时用 name + statusCode 摘要', () => {
    const view = parseEvidence(spanItem('model-request', 'failed'), evidence(
      spanStarted('model-request', { messages: [] }),
      spanCompleted('model-request', 'failed', undefined, { name: 'AI_APICallError', statusCode: 429, url: 'https://api.example.com', isRetryable: true }),
    ))
    expect(view.type).toBe('model-request')
    if (view.type !== 'model-request')
      return
    expect(view.errorText).toBe('AI_APICallError（HTTP 429）')
  })

  it('缺少 span-completed 时标记为未结束，状态回退到时间线', () => {
    const view = parseEvidence(spanItem('model-request'), evidence(
      spanStarted('model-request', { messages: [] }),
    ))
    expect(view.type).toBe('model-request')
    if (view.type !== 'model-request')
      return
    expect(view.pending).toBe(true)
    expect(view.status).toBe('success')
  })
})

describe('parseEvidence · tool-call', () => {
  it('成功时从 output envelope 解析输出、退出码与耗时', () => {
    const view = parseEvidence(spanItem('tool-call'), evidence(
      spanStarted('tool-call', { toolCallId: 'c1', toolName: 'execute_command', input: { command: 'ls' }, operationType: 'command', interpreter: 'bash', scope: 'workspace', serverName: 'native', step: 2 }),
      spanCompleted('tool-call', 'success', { output: 'file.txt', exitCode: 0, durationMs: 120, diagnostics: { stderr: '' } }),
    ))
    expect(view.type).toBe('tool-call')
    if (view.type !== 'tool-call')
      return
    expect(view.toolName).toBe('execute_command')
    expect(view.interpreter).toBe('bash')
    expect(view.input).toEqual({ command: 'ls' })
    expect(view.outputText).toBe('file.txt')
    expect(view.exitCode).toBe(0)
    expect(view.durationMs).toBe(120)
    expect(view.errorText).toBeUndefined()
  })

  it('失败时从 error envelope 解析失败原因与部分输出', () => {
    const view = parseEvidence(spanItem('tool-call', 'failed'), evidence(
      spanStarted('tool-call', { toolName: 'write', input: { path: '/a' } }),
      spanCompleted('tool-call', 'failed', undefined, { status: 'failed', error: '权限不足', output: '部分写入', exitCode: 1, durationMs: 30 }),
    ))
    expect(view.type).toBe('tool-call')
    if (view.type !== 'tool-call')
      return
    expect(view.errorText).toBe('权限不足')
    expect(view.outputText).toBe('部分写入')
    expect(view.exitCode).toBe(1)
  })

  it('失败原因与结果文本相同时去重，不重复展示输出', () => {
    const view = parseEvidence(spanItem('tool-call', 'failed'), evidence(
      spanStarted('tool-call', { toolName: 'read_file', input: { path: 'README.md' } }),
      spanCompleted('tool-call', 'failed', undefined, { status: 'failed', error: 'ENOENT: no such file', output: 'ENOENT: no such file', durationMs: 9 }),
    ))
    expect(view.type).toBe('tool-call')
    if (view.type !== 'tool-call')
      return
    expect(view.errorText).toBe('ENOENT: no such file')
    expect(view.outputText).toBeUndefined()
  })

  it('抛出的异常经脱敏后从 message 提取失败原因', () => {
    const view = parseEvidence(spanItem('tool-call', 'failed'), evidence(
      spanStarted('tool-call', { toolName: 'execute_command', command: { interpreter: 'cmd' } }),
      spanCompleted('tool-call', 'failed', undefined, { name: 'Error', message: 'spawn ENOENT' }),
    ))
    expect(view.type).toBe('tool-call')
    if (view.type !== 'tool-call')
      return
    expect(view.errorText).toBe('spawn ENOENT')
  })

  it('参数中的脱敏标记原样保留', () => {
    const view = parseEvidence(spanItem('tool-call'), evidence(
      spanStarted('tool-call', { toolName: 'http', input: { url: 'https://a', apiKey: '[secret]', token: 'Bearer [secret]' } }),
    ))
    expect(view.type).toBe('tool-call')
    if (view.type !== 'tool-call')
      return
    expect(view.input).toEqual({ url: 'https://a', apiKey: '[secret]', token: 'Bearer [secret]' })
  })
})

describe('parseEvidence · policy-decision', () => {
  it('解析记忆授权命中的初始判定与最终判定', () => {
    const view = parseEvidence(spanItem('policy-decision', 'allow'), evidence(
      spanStarted('policy-decision', { toolName: 'write', input: { path: '/a' }, operationType: 'write', scope: 'workspace', policy: 'require_approval', basis: 'default.require-approval', initialDecision: { outcome: 'require_approval', basis: 'default.require-approval' }, mode: 'strict', step: 1, toolCallId: 'c1' }),
      spanCompleted('policy-decision', 'allow', {
        status: 'allow',
        outcome: 'allow',
        effectiveDecision: { outcome: 'allow', basis: 'approval-grant.match' },
        permissionRules: [
          { ruleId: 'rule-a', kind: 'filesystem', effect: 'allow', group: 'workspace' },
          { ruleId: 'rule-b', kind: 'filesystem', effect: 'allow', group: 'global' },
        ],
      }),
    ))
    expect(view.type).toBe('policy-decision')
    if (view.type !== 'policy-decision')
      return
    expect(view.outcome).toBe('allow')
    expect(view.permissionRules).toEqual([
      { ruleId: 'rule-a', kind: 'filesystem', effect: 'allow', group: 'workspace' },
      { ruleId: 'rule-b', kind: 'filesystem', effect: 'allow', group: 'global' },
    ])
    expect(view.policy).toBe('require_approval')
    expect(view.initialBasis).toBe('default.require-approval')
    expect(view.basis).toBe('approval-grant.match')
    expect(view.mode).toBe('strict')
  })

  it('解析阻止判断与原因', () => {
    const view = parseEvidence(spanItem('policy-decision', 'block'), evidence(
      spanStarted('policy-decision', { toolName: 'write', operationType: 'write', basis: 'automation.write.blocked', automationPolicy: { workspaceAccess: 'read', allowCommandExecution: false, commandPatterns: [], allowMcpTools: false } }),
      spanCompleted('policy-decision', 'block', { status: 'block', outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: '自动化任务仅有工作区读取权限' }),
    ))
    expect(view.type).toBe('policy-decision')
    if (view.type !== 'policy-decision')
      return
    expect(view.outcome).toBe('block')
    expect(view.reason).toBe('自动化任务仅有工作区读取权限')
    expect(view.errorCode).toBe('AGENT_POLICY_BLOCKED')
    expect(view.basis).toBe('automation.write.blocked')
    expect(view.automationPolicy).toMatchObject({ workspaceAccess: 'read' })
  })

  it('解析审批判断结果', () => {
    const view = parseEvidence(spanItem('policy-decision', 'approval'), evidence(
      spanStarted('policy-decision', { toolName: 'write', basis: 'scope.outside', mode: 'hybrid' }),
      spanCompleted('policy-decision', 'approval', { status: 'approval', outcome: 'block', approval: { approved: false, reason: 'AGENT_APPROVAL_REJECTED' } }),
    ))
    expect(view.type).toBe('policy-decision')
    if (view.type !== 'policy-decision')
      return
    expect(view.approvalApproved).toBe(false)
    expect(view.approvalReason).toBe('AGENT_APPROVAL_REJECTED')
    expect(view.basis).toBe('scope.outside')
  })
})

describe('parseEvidence · context-event', () => {
  it('解析 steering 事件文本', () => {
    const item: AgentTurnTimelineItem = { type: 'context-event', recordId: 'e1', kind: 'steering', recordedAt: 2100 }
    const view = parseEvidence(item, evidence(contextEvent({ kind: 'steering', messageId: 'm1', turnId: 't1', text: '继续' })))
    expect(view.type).toBe('context-event')
    if (view.type !== 'context-event')
      return
    expect(view.text).toBe('继续')
    expect(view.messageId).toBe('m1')
  })

  it('解析 compaction 事件的触发方式与摘要', () => {
    const item: AgentTurnTimelineItem = { type: 'context-event', recordId: 'e1', kind: 'compaction', recordedAt: 2100 }
    const view = parseEvidence(item, evidence(contextEvent({
      kind: 'compaction',
      trigger: 'automatic',
      compactedThroughMessageId: 'a1',
      input: { contextEntries: [{}, {}, {}] },
      output: { messages: [{}], summaryText: '早期摘要' },
    })))
    expect(view.type).toBe('context-event')
    if (view.type !== 'context-event')
      return
    expect(view.trigger).toBe('automatic')
    expect(view.summaryText).toBe('早期摘要')
    expect(view.inputMessageCount).toBe(3)
    expect(view.outputMessageCount).toBe(1)
  })
})

describe('parseEvidence · 降级', () => {
  it('证据为 null 时回退并保留时间线状态', () => {
    const view = parseEvidence(spanItem('model-request', 'failed'), null)
    expect(view).toMatchObject({ type: 'fallback', status: 'failed', reason: '原始证据不可用' })
  })

  it('缺少 span-started 记录时回退', () => {
    const view = parseEvidence(spanItem('tool-call'), evidence(
      spanCompleted('tool-call', 'success', {}),
    ))
    expect(view.type).toBe('fallback')
  })

  it('input 结构完全不符时不抛错，字段为空', () => {
    const view = parseEvidence(spanItem('model-request'), evidence(
      spanStarted('model-request', 'garbage'),
    ))
    expect(view.type).toBe('model-request')
    if (view.type !== 'model-request')
      return
    expect(view.model).toBeUndefined()
    expect(view.messages).toEqual([])
  })
})

describe('policyBasisLabel / agentModeLabel', () => {
  it('覆盖交互与自动化判定依据', () => {
    expect(policyBasisLabel('mode.full-managed')).toBe('完全访问权限模式：允许全部操作')
    expect(policyBasisLabel('workspace.read')).toBe('工作区内只读操作默认允许')
    expect(policyBasisLabel('command.risk.require-approval')).toBe('高风险命令需要本次人工审批')
    expect(policyBasisLabel('command.bottomline-block')).toBe('命令触及不可覆盖的系统保护边界')
    expect(policyBasisLabel('automation.write.blocked')).toBe('自动化任务仅有工作区读取权限')
    expect(policyBasisLabel('automation.command.pattern-blocked')).toBe('命令不在自动化任务允许范围内')
    expect(policyBasisLabel('automation.no-policy')).toBe('自动化任务未配置权限策略，安全默认拒绝')
    expect(policyBasisLabel('future.unknown-basis')).toBe('future.unknown-basis')
    expect(policyBasisLabel(undefined)).toBeUndefined()
  })

  it('覆盖权限模式标签', () => {
    expect(agentModeLabel('strict')).toBe('默认权限')
    expect(agentModeLabel('hybrid')).toBe('自动审查')
    expect(agentModeLabel('full_managed')).toBe('完全访问权限')
    expect(agentModeLabel(undefined)).toBeUndefined()
  })
})

describe('spanStatusLabel', () => {
  it('覆盖全部 span 状态', () => {
    expect(spanStatusLabel(undefined, true)).toBe('未结束')
    expect(spanStatusLabel('success', false)).toBe('成功')
    expect(spanStatusLabel('failed', false)).toBe('失败')
    expect(spanStatusLabel('cancelled', false)).toBe('已取消')
    expect(spanStatusLabel('allow', false)).toBe('允许')
    expect(spanStatusLabel('block', false)).toBe('已阻止')
    expect(spanStatusLabel('blocked', false)).toBe('已阻止')
    expect(spanStatusLabel('approval', false)).toBe('需审批')
  })
})

function spanItem(kind: TraceSpanKind, status?: TraceSpanStatus): AgentTurnTimelineItem {
  return { type: 'span', recordId: 'r1', spanId: 's1', kind, status: status ?? 'success', startedAt: 2000, endedAt: 2200, durationMs: 200 }
}

function spanStarted(kind: TraceSpanKind, input: unknown): AgentObservabilityRecord {
  return { schemaVersion: 1, sequence: 1, recordedAt: 2000, traceId: 'trace-1', recordId: 'r1', recordType: 'span-started', spanId: 's1', spanKind: kind, startedAt: 2000, input }
}

function spanCompleted(kind: TraceSpanKind, status: TraceSpanStatus, output?: unknown, error?: unknown): AgentObservabilityRecord {
  return { schemaVersion: 1, sequence: 2, recordedAt: 2200, traceId: 'trace-1', recordId: 'r2', recordType: 'span-completed', spanId: 's1', spanKind: kind, status, endedAt: 2200, output, error }
}

function contextEvent(event: unknown): AgentObservabilityRecord {
  const kind = (event as { kind: 'compaction' | 'steering' | 'history-rewrite' }).kind
  return { schemaVersion: 1, sequence: 1, recordedAt: 2100, traceId: 'trace-1', recordId: 'e1', recordType: 'context-event', eventKind: kind, evidence: event }
}

function evidence(...records: AgentObservabilityRecord[]): AgentObservabilityEvidence {
  return { recordId: records[0].recordId, records }
}
