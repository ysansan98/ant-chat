import { describe, expect, it } from 'vitest'
import {
  AgentObservabilityRecordSchema,
  AgentTurnSummarySchema,
  APP_RENDERER_EVENT_NAMES,
  GeneralSettingsSchema,
} from '../..'
import type { AppRendererEvents } from '../..'

describe('智能体可观测性合同', () => {
  it('完整保留可观测记录的原始证据', () => {
    const record = {
      schemaVersion: 1,
      sequence: 2,
      recordedAt: 200,
      traceId: 'trace-1',
      recordId: 'record-2',
      recordType: 'span-started',
      spanId: 'span-1',
      parentSpanId: 'trace-1',
      spanKind: 'model-request',
      startedAt: 190,
      input: {
        model: 'gpt-5',
        messages: [{ role: 'user', content: '真实输入' }],
      },
    }

    expect(AgentObservabilityRecordSchema.parse(record)).toEqual(record)
  })

  it('拒绝伪解析未知 schema 版本', () => {
    expect(() => AgentObservabilityRecordSchema.parse({
      schemaVersion: 2,
      sequence: 0,
      recordedAt: 100,
      traceId: 'trace-1',
      recordId: 'record-1',
      recordType: 'trace-started',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      availability: 'available',
      source: { type: 'interactive' },
      startedAt: 100,
    })).toThrow()
  })

  it('往返解析 Turn 摘要并区分业务终态与证据完整性', () => {
    const summary = {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      availability: 'available',
      traceId: 'trace-1',
      source: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        allowedSkills: [],
        allowedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSelectedSkillRuntime: false,
          allowMcpMutations: false,
          extraFileRoots: [],
          allowBashCommands: false,
          bashCommandPatterns: [],
        },
      },
      taskId: 'task-1',
      lifecycle: 'completed',
      status: 'failed',
      completeness: 'incomplete',
      incompleteReasons: ['disk'],
      startedAt: 100,
      endedAt: 250,
      durationMs: 150,
      spanCounts: {
        modelRequests: 1,
        policyDecisions: 1,
        toolCalls: 1,
        contextEvents: 0,
      },
    }

    expect(AgentTurnSummarySchema.parse(summary)).toEqual(summary)
  })

  it('采集中的 Turn 不伪装成业务终态或不完整 Trace', () => {
    const summary = {
      conversationId: 'conversation-1',
      turnId: 'turn-running',
      availability: 'available',
      lifecycle: 'collecting',
      traceId: 'trace-running',
      source: { type: 'interactive' },
      taskId: 'task-running',
      startedAt: 100,
      spanCounts: {
        modelRequests: 1,
        policyDecisions: 0,
        toolCalls: 0,
        contextEvents: 0,
      },
    }

    expect(AgentTurnSummarySchema.parse(summary)).toEqual(summary)
    expect(() => AgentTurnSummarySchema.parse({
      ...summary,
      status: 'interrupted',
      completeness: 'incomplete',
      incompleteReasons: [],
    })).toThrow()
  })

  it('未知版本、过期与未采集不伪装成空 Trace', () => {
    for (const availability of ['unsupported', 'expired', 'not-collected'] as const) {
      expect(AgentTurnSummarySchema.parse({
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        availability,
      })).toEqual({
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        availability,
      })
    }
  })

  it('开发者工具默认关闭智能体可观测性', () => {
    const settings = GeneralSettingsSchema.parse({
      assistantModelId: '',
      assistantProviderId: '',
      autoGenerateTitle: false,
      proxySettings: { mode: 'none' },
      appearance: { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' },
    })

    expect(settings.developerTools).toEqual({ agentObservabilityEnabled: false })
  })

  it('注册轻量实时失效事件并携带 Turn 身份', () => {
    const payload: AppRendererEvents['observability:turn-settled'] = {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    }

    expect(APP_RENDERER_EVENT_NAMES).toContain('observability:turn-settled')
    expect(payload).toEqual({ conversationId: 'conversation-1', turnId: 'turn-1' })
  })
})
