import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  AgentTurnSummarySchema,
  AppControlCommandSchema,
  AutomationPermissionPolicySchema,
  PolicyBasisSchema,
  ToolCallContentSchema,
} from '../..'
import type {
  ApprovalCandidate,
  AppRpcInput,
  AppRpcOutput,
  CommandHostStatus,
  CommandToolInput,
  SecretRef,
  ToolOperationType,
} from '../..'

describe('平台命令公共合同', () => {
  it('自动化权限使用平台中立的命令字段', () => {
    const policy = AutomationPermissionPolicySchema.parse({
      allowCommandExecution: true,
      commandPatterns: ['git status'],
    })

    expect(policy).toMatchObject({
      allowCommandExecution: true,
      commandPatterns: ['git status'],
    })
    expect(policy).not.toHaveProperty('allowBashCommands')
    expect(policy).not.toHaveProperty('bashCommandPatterns')
  })

  it('拒绝历史 Bash 自动化权限字段', () => {
    expect(AutomationPermissionPolicySchema.safeParse({
      allowBashCommands: true,
      bashCommandPatterns: ['git status'],
    }).success).toBe(false)
  })

  it('应用控制命令只接受平台中立的自动化权限字段', () => {
    const command = {
      type: 'automation',
      action: 'create',
      name: '每日检查',
      prompt: '检查工作区状态',
      workspacePath: '/workspace',
      providerId: 'provider-1',
      modelId: 'model-1',
      schedule: { type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
    } as const

    expect(AppControlCommandSchema.safeParse({
      ...command,
      permissionPolicy: {
        allowCommandExecution: true,
        commandPatterns: ['git status'],
      },
    }).success).toBe(true)
    expect(AppControlCommandSchema.safeParse({
      ...command,
      permissionPolicy: {
        allowBashCommands: true,
        bashCommandPatterns: ['git status'],
      },
    }).success).toBe(false)
  })

  it('工具调用保留命令解释器元数据', () => {
    const toolCall = ToolCallContentSchema.parse({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'execute_command',
      args: { command: 'Get-ChildItem' },
      command: { interpreter: 'powershell7' },
    })

    expect(toolCall.command).toEqual({ interpreter: 'powershell7' })
  })

  it('命令解释器元数据拒绝未知解释器', () => {
    expect(ToolCallContentSchema.safeParse({
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'execute_command',
      args: { command: 'ls' },
      command: { interpreter: 'zsh' },
    }).success).toBe(false)
  })

  it('审批候选携带命令解释器身份', () => {
    const candidate: ApprovalCandidate = {
      type: 'command-segment',
      interpreter: 'cmd',
      segmentIndex: 0,
      executable: 'dir',
      displayCommand: 'dir',
      argvPrefix: [],
      canWholeExecutable: false,
      resourceScope: 'workspace',
    }

    expect(candidate).toMatchObject({
      type: 'command-segment',
      interpreter: 'cmd',
    })
  })

  it('运行时 RPC 只读返回命令宿主公开状态', () => {
    expectTypeOf<AppRpcInput<'runtime.getCommandHostStatus'>>().toEqualTypeOf<undefined>()
    expectTypeOf<AppRpcOutput<'runtime.getCommandHostStatus'>>().toEqualTypeOf<CommandHostStatus>()

    const available: CommandHostStatus = {
      status: 'available',
      platform: 'windows',
      interpreter: 'powershell7',
      executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    }
    const unavailable: CommandHostStatus = {
      status: 'unavailable',
      platform: 'posix',
      candidates: ['/bin/bash'],
      reason: '未找到可执行的 Bash',
    }

    expect(available).not.toHaveProperty('environment')
    expect(unavailable.candidates).toEqual(['/bin/bash'])
  })

  it('命令工具 input 与操作类型不再暴露 Bash 命名', () => {
    expectTypeOf<CommandToolInput>().toMatchObjectType<{
      command: string
      description?: string
      cwd?: string
      timeoutMs?: number
      secretEnv?: Record<string, SecretRef>
    }>()

    const operationTypes: ToolOperationType[] = ['command', 'command_read']
    expect(operationTypes).toEqual(['command', 'command_read'])
  })

  it('可观测性策略依据使用平台中立命名', () => {
    expect(PolicyBasisSchema.parse('command.risk.require-approval')).toBe('command.risk.require-approval')
    expect(PolicyBasisSchema.parse('command.bottomline-block')).toBe('command.bottomline-block')
    expect(PolicyBasisSchema.parse('automation.command.pattern-match')).toBe('automation.command.pattern-match')
    expect(PolicyBasisSchema.safeParse('bash.syntax.require-approval').success).toBe(false)
    expect(PolicyBasisSchema.safeParse('automation.bash.pattern-match').success).toBe(false)
  })

  it('自动化 Turn 摘要只往返平台中立权限字段', () => {
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
          allowBrowser: false,
          allowMcpTools: false,
          extraFileRoots: [],
          allowCommandExecution: false,
          commandPatterns: [],
        },
      },
      lifecycle: 'completed',
      status: 'success',
      completeness: 'complete',
      incompleteReasons: [],
      startedAt: 100,
      endedAt: 120,
      durationMs: 20,
      spanCounts: {
        modelRequests: 1,
        policyDecisions: 0,
        toolCalls: 0,
        contextEvents: 0,
      },
    }

    expect(AgentTurnSummarySchema.parse(summary)).toEqual(summary)
  })
})
