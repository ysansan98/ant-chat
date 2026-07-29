import type { AgentTaskSnapshot, IAgentEventEmitter, ILogger, ToolApprovalRule } from '@ant-chat/shared'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeTask } from '../../taskStore'
import { prepareBashCommand } from '../../native-tools/command/bashCommandAdapter'
import { TaskStore } from '../../taskStore'
import { ToolRegistry } from '../../tools/toolRegistry'
import { createToolAuthorization } from '../toolAuthorization'

function createMockEmitter(): IAgentEventEmitter {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
    emitTurnFinished: vi.fn(),
  }
}

function createMockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function createTask(overrides: Record<string, unknown> = {}): RuntimeTask {
  return {
    snapshot: {
      taskId: 'task-1',
      conversationId: 'conv-1',
      userMessageId: 'msg-1',
      workspacePath: process.cwd(),
      mode: 'hybrid',
      status: 'running',
      prompt: 'test',
      createdAt: 1000,
      updatedAt: 1000,
      ...overrides,
    } as AgentTaskSnapshot,
    abortController: new AbortController(),
  }
}

function createPrepared() {
  return {
    toolName: 'read_file',
    source: 'native' as const,
    serverName: 'native',
    input: { path: 'test.txt' },
    operationType: 'read' as const,
    scope: 'workspace' as const,
    execute: async () => ({ ok: true, result: 'content', diagnostics: { exitCode: 0 } }),
  }
}

function createPreparedCommand(command: string, workspacePath: string) {
  const state = prepareBashCommand(
    { command },
    workspacePath,
    {
      status: 'available',
      platform: 'posix',
      adapter: 'bash',
      interpreter: 'bash',
      executablePath: '/bin/bash',
      environment: { PATH: process.env.PATH ?? '', HOME: os.homedir() },
    },
  )
  return {
    ...createPrepared(),
    toolName: 'execute_command',
    input: { command },
    operationType: state.isReadOnly ? 'command_read' as const : 'command' as const,
    scope: state.risk === 'bottomline_block' ? 'blocked' as const : state.resourceScope,
    preparedState: state,
  }
}

interface ApprovalResult { approved: boolean, reason?: string, selection?: { selections: Array<{ candidateIndex: number }>, scope: 'workspace' | 'global' } }

function createTaskState(waitForApproval: (task: RuntimeTask) => Promise<ApprovalResult>): TaskStore {
  return {
    requestApproval: async (task, pendingAction, eventEmitter) => {
      task.snapshot.status = 'awaiting_approval'
      task.snapshot.pendingAction = pendingAction
      void eventEmitter.emitTaskUpdated(task.snapshot)
      void eventEmitter.emitApprovalRequired(task.snapshot.taskId, task.snapshot.conversationId, pendingAction)
      return await waitForApproval(task)
    },
  } as TaskStore
}

function createRulesProvider(global: ToolApprovalRule[] = [], workspace: ToolApprovalRule[] = []) {
  return {
    getRules: (_workspacePath: string) => ({ global, workspace }),
  }
}

function createAutomationTask(commandPatterns: string[] = []): RuntimeTask {
  return createTask({
    turnSource: {
      type: 'automation',
      automationId: 'automation-1',
      runId: 'run-1',
      allowedSkills: [],
      allowedMcpServers: [],
      permissionPolicy: {
        workspaceAccess: 'write',
        allowSelectedSkillRuntime: false,
        allowBrowser: false,
        allowMcpTools: false,
        extraFileRoots: [],
        allowCommandExecution: true,
        commandPatterns,
      },
    },
  })
}

describe('createToolAuthorization 行为', () => {
  it('自动化只读策略直接阻止写入且不进入交互审批', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({
      turnSource: {
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
    })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'write', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result).toEqual(expect.objectContaining({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED' }))
    expect(waitForApproval).not.toHaveBeenCalled()
  })

  it('自动化策略允许执行当前 Turn 已注入的 Skill', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        allowedSkills: ['review'],
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
    })

    await expect(hook({
      task,
      prepared: { ...createPrepared(), toolName: 'use_skill', operationType: 'skill', scope: 'workspace', input: { name: 'review' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })

    expect(waitForApproval).not.toHaveBeenCalled()
  })

  it('自动化仅在启用命令执行后允许只读命令探测', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const task = createTask({
      turnSource: {
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
          allowCommandExecution: true,
          commandPatterns: [],
        },
      },
    })

    await expect(hook({
      task,
      prepared: createPreparedCommand('which node && node --version', process.cwd()),
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })
  })

  it('自动化未启用命令执行时阻止只读命令探测', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const task = createTask({
      turnSource: {
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
    })

    const result = await hook({
      task,
      prepared: createPreparedCommand('which node && node --version', process.cwd()),
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result).toEqual(expect.objectContaining({ outcome: 'block', reason: '自动化任务未授权命令执行' }))
  })

  it('自动化写命令必须匹配已配置的命令模式', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const allowed = createPreparedCommand('node scripts/build.js', process.cwd())
    const blocked = createPreparedCommand('node scripts/deploy.js', process.cwd())

    await expect(hook({
      task: createAutomationTask(['node scripts/build.js']),
      prepared: allowed,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })
    await expect(hook({
      task: createAutomationTask(['node scripts/build.js']),
      prepared: blocked,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual(expect.objectContaining({ outcome: 'block', reason: '命令不在自动化任务允许范围内' }))
    expect(waitForApproval).not.toHaveBeenCalled()
  })

  it('自动化阻止工作区外命令且不进入交互审批', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const prepared = createPreparedCommand('git status', process.cwd())
    prepared.scope = 'outside'
    prepared.preparedState.resourceScope = 'outside'

    await expect(hook({
      task: createAutomationTask(),
      prepared,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual(expect.objectContaining({ outcome: 'block', reason: '自动化任务不允许访问工作区外资源' }))
    expect(waitForApproval).not.toHaveBeenCalled()
  })

  it('自动化命中显式模式时执行非底线高风险命令且不等待审批', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval))

    await expect(hook({
      task: createAutomationTask(['rm -rf ./dist']),
      prepared: createPreparedCommand('rm -rf ./dist', process.cwd()),
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })
    expect(waitForApproval).not.toHaveBeenCalled()
  })

  it('自动化权限策略不能覆盖命令底线', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval))

    await expect(hook({
      task: createAutomationTask(['*']),
      prepared: createPreparedCommand('rm -rf /', process.cwd()),
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual(expect.objectContaining({ outcome: 'block', reason: expect.stringContaining('底线保护') }))
    expect(waitForApproval).not.toHaveBeenCalled()
  })

  it('交互高风险命令只允许单次审批且不生成持久规则候选', async () => {
    let resolveApproval!: (value: ApprovalResult) => void
    const task = createTask({ mode: 'strict' })
    const hook = createToolAuthorization(createTaskState(() => new Promise<ApprovalResult>((resolve) => {
      resolveApproval = resolve
    })))

    const result = hook({
      task,
      prepared: createPreparedCommand('rm -rf ./dist', process.cwd()),
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(task.snapshot.pendingAction?.approvalCandidates).toBeUndefined()
    resolveApproval({ approved: true })
    await expect(result).resolves.toEqual({ outcome: 'allow' })
  })

  it('hybrid 模式下 workspace read 返回 allow', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const task = createTask({ mode: 'hybrid' })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result).toEqual({ outcome: 'allow' })
  })

  it('blocked scope 返回 block', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const task = createTask({ mode: 'strict' })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'blocked' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result.outcome).toBe('block')
    if (result.outcome === 'block') {
      expect(result.errorCode).toBe('AGENT_POLICY_BLOCKED')
    }
  })

  it('完全访问权限也不能绕过系统硬阻断', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const task = createTask({ mode: 'full_managed' })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'write', scope: 'blocked' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result).toMatchObject({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED' })
  })

  it('命令底线阻断的 Policy span 保留解释器、初始结论、最终结论和原因', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-command-bottomline-'))
    try {
      const waitForApproval = vi.fn(async () => ({ approved: true }))
      const policySpan = { id: 'policy-command', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
      const startPolicyDecision = vi.fn(() => policySpan)
      const hook = createToolAuthorization(createTaskState(waitForApproval))
      const prepared = createPreparedCommand('rm -rf /', workspacePath)

      await expect(hook({
        task: createTask({ mode: 'full_managed', workspacePath }),
        prepared,
        config: {
          eventEmitter: createMockEmitter(),
          logger: createMockLogger(),
          turnRecorder: {
            startModelRequest: vi.fn(),
            startToolCall: vi.fn(),
            startPolicyDecision,
            recordContextEvent: vi.fn(),
            finish: vi.fn(),
          },
        },
      })).resolves.toMatchObject({
        outcome: 'block',
        errorCode: 'AGENT_POLICY_BLOCKED',
        reason: expect.stringContaining('底线保护'),
      })

      expect(startPolicyDecision).toHaveBeenCalledWith(expect.objectContaining({
        toolName: 'execute_command',
        interpreter: 'bash',
        command: {
          interpreter: 'bash',
          risk: 'bottomline_block',
          riskReason: expect.stringContaining('底线保护'),
        },
        initialDecision: {
          outcome: 'block',
          basis: 'command.bottomline-block',
        },
      }), undefined)
      expect(policySpan.complete).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'block',
        effectiveDecision: {
          outcome: 'block',
          basis: 'command.bottomline-block',
        },
        reason: expect.stringContaining('底线保护'),
      }))
      expect(waitForApproval).not.toHaveBeenCalled()
    }
    finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('黑名单优先于白名单和完全访问权限，且仅阻止工具调用', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-deny-rule-'))
    try {
      const command = 'git status | cat'
      const rules = createRulesProvider([
        {
          id: 'allow-git',
          kind: 'command',
          interpreter: 'bash',
          executable: 'git',
          argvPrefix: ['status'],
          allowRemainingArgs: false,
          resourceScope: 'workspace',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'deny-git',
          effect: 'deny',
          kind: 'command',
          interpreter: 'bash',
          executable: 'git',
          argvPrefix: ['status'],
          allowRemainingArgs: false,
          resourceScope: 'workspace',
          createdAt: 0,
          updatedAt: 0,
        },
      ])
      const waitForApproval = vi.fn(async () => ({ approved: true }))
      const hook = createToolAuthorization(createTaskState(waitForApproval), rules)

      const result = await hook({
        task: createTask({ mode: 'full_managed', workspacePath }),
        prepared: createPreparedCommand(command, workspacePath),
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      })

      expect(result).toEqual(expect.objectContaining({
        outcome: 'block',
        reason: '已被权限黑名单阻止：git status',
        continueAgent: true,
      }))
      expect(waitForApproval).not.toHaveBeenCalled()
    }
    finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('完全访问权限直接放行非底线的复杂命令且不进入审批', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-shell-approval-'))
    try {
      const waitForApproval = vi.fn(async () => ({ approved: true }))
      const hook = createToolAuthorization(createTaskState(waitForApproval))

      await expect(hook({
        task: createTask({ mode: 'full_managed', workspacePath }),
        prepared: createPreparedCommand('git diff | head -20', workspacePath),
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      })).resolves.toEqual({ outcome: 'allow' })

      expect(waitForApproval).not.toHaveBeenCalled()
    }
    finally {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  it('工具能力与资源域不一致时任何模式都直接阻断', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))

    // mcp 工具只允许 external scope，workspace scope 是资源域不一致 → 直接阻断
    await expect(hook({
      task: createTask({ mode: 'strict' }),
      prepared: {
        ...createPrepared(),
        toolName: 'github___create_issue',
        operationType: 'mcp',
        scope: 'workspace',
        serverName: 'github',
        originalToolName: 'create_issue',
      },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toMatchObject({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED' })

    // browser 工具只允许 external/outside scope，workspace scope 是资源域不一致 → 即使 full_managed 也阻断
    await expect(hook({
      task: createTask({ mode: 'full_managed' }),
      prepared: { ...createPrepared(), toolName: 'browser_navigate', operationType: 'browser', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toMatchObject({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED' })
  })

  it('strict 模式下 workspace write 进入审批', async () => {
    let resolveApproval!: (value: ApprovalResult) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<ApprovalResult>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), operationType: 'write', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(task.snapshot.status).toBe('awaiting_approval')
    resolveApproval({ approved: true })
    const result = await resultPromise
    expect(result).toEqual({ outcome: 'allow' })
  })

  it('hybrid 模式下 workspace write 直接放行', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval))

    await expect(hook({
      task: createTask({ mode: 'hybrid' }),
      prepared: { ...createPrepared(), operationType: 'write', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })

    expect(waitForApproval).not.toHaveBeenCalled()
  })

  it('用户拒绝审批时返回 block', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: false, reason: '用户拒绝' })))

    const result = await hook({
      task: createTask({ mode: 'strict' }),
      prepared: { ...createPrepared(), operationType: 'write', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result.outcome).toBe('block')
  })

  it('outside scope 在 strict 模式下进入审批', async () => {
    let resolveApproval!: (value: ApprovalResult) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<ApprovalResult>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'outside' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(task.snapshot.status).toBe('awaiting_approval')
    resolveApproval({ approved: true })
    await expect(resultPromise).resolves.toEqual({ outcome: 'allow' })
  })

  it('权限规则读取失败时记录错误并继续进入人工审批', async () => {
    const readError = new Error('权限文件已隔离')
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const policySpan = { id: 'policy-1', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const readSpan = { id: 'policy-read-1', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = {
      startModelRequest: vi.fn(),
      startToolCall: vi.fn(),
      startPolicyDecision: vi.fn()
        .mockReturnValueOnce(policySpan)
        .mockReturnValueOnce(readSpan),
      recordContextEvent: vi.fn(),
      finish: vi.fn(),
    }
    const hook = createToolAuthorization(createTaskState(waitForApproval), {
      getRules: () => { throw readError },
    })

    await expect(hook({
      task: createTask({ mode: 'strict' }),
      prepared: { ...createPrepared(), operationType: 'read', scope: 'outside' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger(), turnRecorder },
    })).resolves.toEqual({ outcome: 'allow' })

    expect(waitForApproval).toHaveBeenCalledTimes(1)
    expect(turnRecorder.startPolicyDecision).toHaveBeenNthCalledWith(2, expect.objectContaining({
      input: { phase: 'approval-rule-read' },
      basis: 'approval.rule-read-failed',
    }), policySpan.id)
    expect(readSpan.fail).toHaveBeenCalledWith(readError)
    expect(policySpan.fail).not.toHaveBeenCalled()
    expect(policySpan.complete).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'allow',
      effectiveDecision: { outcome: 'allow', basis: 'approval.user-approved' },
    }))
  })

  it('权限规则读取失败时交互基础 allow 降级为人工审批', async () => {
    let resolveApproval!: (value: ApprovalResult) => void
    const waitForApproval = vi.fn(() => new Promise<ApprovalResult>((resolve) => {
      resolveApproval = resolve
    }))
    const hook = createToolAuthorization(createTaskState(waitForApproval), {
      getRules: () => { throw new Error('permissions unavailable') },
    })
    const task = createTask({ mode: 'hybrid' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(task.snapshot.status).toBe('awaiting_approval')
    expect(waitForApproval).toHaveBeenCalledOnce()
    resolveApproval({ approved: true })
    await expect(resultPromise).resolves.toEqual({ outcome: 'allow' })
  })

  it('权限规则读取失败时 automation 基础 allow 直接阻断', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval), {
      getRules: () => { throw new Error('permissions unavailable') },
    })
    const task = createTask({
      turnSource: {
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
    })

    await expect(hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toMatchObject({
      outcome: 'block',
      errorCode: 'AGENT_POLICY_BLOCKED',
      reason: expect.stringContaining('权限文件读取失败'),
    })
    expect(waitForApproval).not.toHaveBeenCalled()
  })

  it('automation 不读取交互权限规则', async () => {
    const rules = createRulesProvider(
      [{ id: 'rule-1', kind: 'mcp-tool', serverName: 'test', toolName: 'tool', createdAt: 0, updatedAt: 0 }],
    )
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval), rules)
    const task = createTask({
      turnSource: {
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
    })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), toolName: 'test___tool', operationType: 'mcp', scope: 'external' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    // 自动化策略未授权 MCP → block，不查询权限规则
    expect(result.outcome).toBe('block')
    expect(waitForApproval).not.toHaveBeenCalled()
  })

  it('复合命令审批只展示未被规则覆盖的命令段', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-partial-bash-rule-'))
    try {
      const command = 'git checkout main && node scripts/run.js'
      const rules = createRulesProvider([{
        id: 'allow-git-checkout',
        kind: 'command',
        interpreter: 'bash',
        executable: 'git',
        argvPrefix: ['checkout', 'main'],
        allowRemainingArgs: false,
        resourceScope: 'workspace',
        createdAt: 0,
        updatedAt: 0,
      }])
      let resolveApproval!: (value: ApprovalResult) => void
      const waitForApproval = vi.fn(() => new Promise<ApprovalResult>((resolve) => {
        resolveApproval = resolve
      }))
      const task = createTask({ mode: 'strict', workspacePath: root })
      const hook = createToolAuthorization(createTaskState(waitForApproval), rules)

      const resultPromise = hook({
        task,
        prepared: createPreparedCommand(command, root),
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      })

      expect(task.snapshot.pendingAction?.approvalCandidates?.candidates).toEqual([
        expect.objectContaining({
          type: 'command-segment',
          interpreter: 'bash',
          executable: 'node',
          argvPrefix: ['scripts/run.js'],
        }),
      ])
      resolveApproval({ approved: true })
      await expect(resultPromise).resolves.toEqual({ outcome: 'allow' })
    }
    finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('bash 命令规则不能授权 Windows 解释器中的同名命令', async () => {
    const prepared = createPreparedCommand('node scripts/run.js', process.cwd())
    prepared.preparedState.interpreter = 'powershell7'
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(
      createTaskState(waitForApproval),
      createRulesProvider([{
        id: 'bash-node-rule',
        kind: 'command',
        interpreter: 'bash',
        executable: 'node',
        argvPrefix: ['scripts/run.js'],
        allowRemainingArgs: false,
        resourceScope: 'workspace',
        createdAt: 0,
        updatedAt: 0,
      }]),
    )

    await expect(hook({
      task: createTask({ mode: 'strict' }),
      prepared,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })
    expect(waitForApproval).toHaveBeenCalledOnce()
  })

  it('复合命令被多条规则共同覆盖时 Trace 记录全部命中规则', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-bash-rule-trace-'))
    try {
      const command = 'git checkout main && node scripts/run.js'
      const rules = createRulesProvider(
        [{
          id: 'allow-git-checkout',
          kind: 'command',
          interpreter: 'bash',
          executable: 'git',
          argvPrefix: ['checkout', 'main'],
          allowRemainingArgs: false,
          resourceScope: 'workspace',
          createdAt: 0,
          updatedAt: 0,
        }],
        [{
          id: 'allow-node-run',
          kind: 'command',
          interpreter: 'bash',
          executable: 'node',
          argvPrefix: ['scripts/run.js'],
          allowRemainingArgs: false,
          resourceScope: 'workspace',
          createdAt: 0,
          updatedAt: 0,
        }],
      )
      const policySpan = { id: 'policy-1', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
      const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })), rules)

      await expect(hook({
        task: createTask({ mode: 'strict', workspacePath: root }),
        prepared: createPreparedCommand(command, root),
        config: {
          eventEmitter: createMockEmitter(),
          logger: createMockLogger(),
          turnRecorder: {
            startModelRequest: vi.fn(),
            startToolCall: vi.fn(),
            startPolicyDecision: vi.fn(() => policySpan),
            recordContextEvent: vi.fn(),
            finish: vi.fn(),
          },
        },
      })).resolves.toEqual({ outcome: 'allow' })

      expect(policySpan.complete).toHaveBeenCalledWith(expect.objectContaining({
        effectiveDecision: { outcome: 'allow', basis: 'approval-grant.match' },
        permissionRules: [
          { ruleId: 'allow-git-checkout', kind: 'command', effect: 'allow', group: 'global' },
          { ruleId: 'allow-node-run', kind: 'command', effect: 'allow', group: 'workspace' },
        ],
      }))
    }
    finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('文件系统规则匹配时自动批准', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-fs-rule-'))
    try {
      const filePath = path.join(root, 'src', 'index.ts')
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, 'content')
      const realPath = fs.realpathSync.native(filePath)

      const rules = createRulesProvider([], [
        {
          id: 'rule-1',
          kind: 'filesystem',
          access: 'write',
          targetType: 'file',
          canonicalPath: realPath,
          recursive: false,
          createdAt: 0,
          updatedAt: 0,
        },
      ])

      const emitter = createMockEmitter()
      const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })), rules)

      const result = await hook({
        task: createTask({ mode: 'strict', workspacePath: root }),
        prepared: { ...createPrepared(), toolName: 'write_file', operationType: 'write', scope: 'workspace', input: { path: 'src/index.ts' } },
        config: { eventEmitter: emitter, logger: createMockLogger() },
      })

      expect(result).toEqual({ outcome: 'allow' })
      expect(emitter.emitApprovalRequired).not.toHaveBeenCalled()
    }
    finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('文件系统规则不匹配时仍请求审批', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-fs-nomatch-'))
    try {
      const rules = createRulesProvider([], [
        {
          id: 'rule-1',
          kind: 'filesystem',
          access: 'write',
          targetType: 'file',
          canonicalPath: '/workspace/other.ts',
          recursive: false,
          createdAt: 0,
          updatedAt: 0,
        },
      ])

      let resolveApproval!: (value: ApprovalResult) => void
      const waitForApproval = vi.fn().mockImplementation(() => {
        return new Promise<ApprovalResult>((resolve) => {
          resolveApproval = resolve
        })
      })

      const hook = createToolAuthorization(createTaskState(waitForApproval), rules)
      const task = createTask({ mode: 'strict', workspacePath: root })

      const resultPromise = hook({
        task,
        prepared: { ...createPrepared(), toolName: 'write_file', operationType: 'write', scope: 'workspace', input: { path: 'src/index.ts' } },
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      })

      expect(task.snapshot.status).toBe('awaiting_approval')
      resolveApproval({ approved: true })
      const result = await resultPromise
      expect(result).toEqual({ outcome: 'allow' })
    }
    finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('目录递归读取规则覆盖子目录文件', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-dir-rule-'))
    try {
      const subDir = path.join(root, 'src')
      const filePath = path.join(subDir, 'index.ts')
      fs.mkdirSync(subDir, { recursive: true })
      fs.writeFileSync(filePath, 'content')
      const realDir = fs.realpathSync.native(subDir)

      const rules = createRulesProvider([], [
        {
          id: 'rule-1',
          kind: 'filesystem',
          access: 'read',
          targetType: 'directory',
          canonicalPath: realDir,
          recursive: true,
          createdAt: 0,
          updatedAt: 0,
        },
      ])

      const emitter = createMockEmitter()
      const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })), rules)

      const result = await hook({
        task: createTask({ mode: 'strict', workspacePath: root }),
        prepared: { ...createPrepared(), toolName: 'read_file', operationType: 'read', scope: 'workspace', input: { path: 'src/index.ts' } },
        config: { eventEmitter: emitter, logger: createMockLogger() },
      })

      expect(result).toEqual({ outcome: 'allow' })
      expect(emitter.emitApprovalRequired).not.toHaveBeenCalled()
    }
    finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('命令准备态生成的候选可直接匹配规则并执行同一命令', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-bash-rule-'))
    try {
      const registry = await ToolRegistry.create({
        config: {
          eventEmitter: createMockEmitter(),
          logger: createMockLogger(),
          commandHost: {
            status: 'available',
            platform: 'posix',
            adapter: 'bash',
            interpreter: 'bash',
            executablePath: '/bin/bash',
            environment: { PATH: process.env.PATH ?? '', HOME: os.homedir() },
          },
        },
        workspacePath: root,
        mode: 'strict',
        turnSource: { type: 'interactive' },
      })
      const prepared = registry.prepare('execute_command', { command: 'node -e "console.log(1)"' })
      let resolveApproval!: (value: ApprovalResult) => void
      const firstHook = createToolAuthorization(createTaskState(() => new Promise<ApprovalResult>((resolve) => {
        resolveApproval = resolve
      })), createRulesProvider())
      const firstTask = createTask({ mode: 'strict', workspacePath: root })
      const firstResult = firstHook({
        task: firstTask,
        prepared,
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      })

      const candidate = firstTask.snapshot.pendingAction?.approvalCandidates?.candidates[0]
      expect(candidate).toMatchObject({
        type: 'command-segment',
        interpreter: 'bash',
        argvPrefix: ['-e', 'console.log(1)'],
        resourceScope: 'workspace',
      })
      if (!candidate || candidate.type !== 'command-segment') {
        throw new Error('缺少命令审批候选')
      }
      resolveApproval({ approved: true })
      await expect(firstResult).resolves.toEqual({ outcome: 'allow' })

      const rule: ToolApprovalRule = {
        id: 'command-rule-1',
        kind: 'command',
        interpreter: candidate.interpreter,
        executable: candidate.executable,
        argvPrefix: [...candidate.argvPrefix],
        allowRemainingArgs: false,
        resourceScope: candidate.resourceScope,
        createdAt: 0,
        updatedAt: 0,
      }
      const secondEmitter = createMockEmitter()
      const secondHook = createToolAuthorization(
        createTaskState(async () => ({ approved: true })),
        createRulesProvider([rule]),
      )
      const secondPrepared = registry.prepare('execute_command', { command: 'node -e "console.log(1)"' })

      await expect(secondHook({
        task: createTask({ mode: 'strict', workspacePath: root }),
        prepared: secondPrepared,
        config: { eventEmitter: secondEmitter, logger: createMockLogger() },
      })).resolves.toEqual({ outcome: 'allow' })
      expect(secondEmitter.emitApprovalRequired).not.toHaveBeenCalled()
      await expect(secondPrepared.execute()).resolves.toMatchObject({ ok: true, diagnostics: { stdout: '1\n' } })
    }
    finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('mCP 规则按独立 server/tool 身份匹配', async () => {
    const rules = createRulesProvider([
      {
        id: 'rule-1',
        kind: 'mcp-tool',
        serverName: 'github',
        toolName: 'create_issue',
        createdAt: 0,
        updatedAt: 0,
      },
    ])

    const emitter = createMockEmitter()
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })), rules)

    const result = await hook({
      task: createTask({ mode: 'strict' }),
      prepared: {
        ...createPrepared(),
        toolName: 'github___create_issue',
        operationType: 'mcp',
        scope: 'external',
        input: { title: 'test' },
        serverName: 'github',
        originalToolName: 'create_issue',
      },
      config: { eventEmitter: emitter, logger: createMockLogger() },
    })

    expect(result).toEqual({ outcome: 'allow' })
    expect(emitter.emitApprovalRequired).not.toHaveBeenCalled()
  })

  it('mCP 规则不匹配不同 server 的同名 tool', async () => {
    const rules = createRulesProvider([
      {
        id: 'rule-1',
        kind: 'mcp-tool',
        serverName: 'github',
        toolName: 'create_issue',
        createdAt: 0,
        updatedAt: 0,
      },
    ])

    let resolveApproval!: (value: ApprovalResult) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<ApprovalResult>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval), rules)

    const resultPromise = hook({
      task: createTask({ mode: 'strict' }),
      prepared: {
        ...createPrepared(),
        toolName: 'gitlab___create_issue',
        operationType: 'mcp',
        scope: 'external',
        input: { title: 'test' },
        serverName: 'gitlab',
        originalToolName: 'create_issue',
      },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(waitForApproval).toHaveBeenCalledOnce()
    resolveApproval({ approved: true })
    await resultPromise
  })

  it('错误 actionId 不会提前写入权限规则', async () => {
    const taskStore = new TaskStore()
    const task = createTask({ mode: 'strict' })
    taskStore.reserve(task)
    const saveRules = vi.fn()
    const hook = createToolAuthorization(taskStore, {
      getRules: () => ({ global: [], workspace: [] }),
    })
    const result = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'write_file', operationType: 'write', scope: 'workspace', input: { path: 'test.txt' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })
    await vi.waitFor(() => expect(task.snapshot.pendingAction).toBeDefined())

    expect(() => taskStore.approve(task.snapshot.taskId, 'stale-action', undefined, saveRules))
      .toThrow('Approval action mismatch')
    expect(saveRules).not.toHaveBeenCalled()

    // 仅本次批准（不传 selection）不需要 saveRules
    taskStore.approve(task.snapshot.taskId, task.snapshot.pendingAction!.actionId, undefined)
    await expect(result).resolves.toEqual({ outcome: 'allow' })
  })

  it('权限规则持久化失败时不返回允许执行', async () => {
    const taskStore = new TaskStore()
    const task = createTask({ mode: 'strict' })
    taskStore.reserve(task)
    const hook = createToolAuthorization(taskStore, {
      getRules: () => ({ global: [], workspace: [] }),
    })
    const result = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'write_file', operationType: 'write', scope: 'workspace', input: { path: 'test.txt' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })
    await vi.waitFor(() => expect(task.snapshot.pendingAction).toBeDefined())

    expect(() => taskStore.approve(
      task.snapshot.taskId,
      task.snapshot.pendingAction!.actionId,
      { selections: [{ candidateIndex: 0 }], scope: 'global' },
      () => { throw new Error('permissions write failed') },
    )).toThrow('permissions write failed')
    expect(task.snapshot.status).toBe('awaiting_approval')
    expect(task.snapshot.pendingAction).toBeDefined()

    taskStore.reject(task.snapshot.taskId, task.snapshot.pendingAction!.actionId, '持久化失败')
    await expect(result).resolves.toMatchObject({ outcome: 'block' })
  })

  it('权限持久化失败单独记录 Trace，重试成功后原审批继续放行', async () => {
    const taskStore = new TaskStore()
    const task = createTask({ mode: 'strict' })
    taskStore.reserve(task)
    const policySpan = { id: 'policy-1', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const persistenceSpan = { id: 'policy-persistence-1', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = {
      startModelRequest: vi.fn(),
      startToolCall: vi.fn(),
      startPolicyDecision: vi.fn()
        .mockReturnValueOnce(policySpan)
        .mockReturnValueOnce(persistenceSpan),
      recordContextEvent: vi.fn(),
      finish: vi.fn(),
    }
    const hook = createToolAuthorization(taskStore, {
      getRules: () => ({ global: [], workspace: [] }),
    })
    const result = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'write_file', operationType: 'write', scope: 'workspace', input: { path: 'test.txt' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger(), turnRecorder },
    })
    await vi.waitFor(() => expect(task.snapshot.pendingAction).toBeDefined())
    const actionId = task.snapshot.pendingAction!.actionId

    expect(() => taskStore.approve(
      task.snapshot.taskId,
      actionId,
      { selections: [{ candidateIndex: 0 }], scope: 'global' },
      () => { throw new Error('权限写入失败') },
    )).toThrow('权限写入失败')

    expect(turnRecorder.startPolicyDecision).toHaveBeenNthCalledWith(2, expect.objectContaining({
      input: { phase: 'approval-rule-persistence', actionId },
      basis: 'approval.persistence-failed',
    }), policySpan.id)
    expect(persistenceSpan.fail).toHaveBeenCalledWith(expect.objectContaining({ message: '权限写入失败' }))
    expect(policySpan.complete).not.toHaveBeenCalled()
    expect(policySpan.fail).not.toHaveBeenCalled()
    expect(task.snapshot.status).toBe('awaiting_approval')

    taskStore.approve(
      task.snapshot.taskId,
      actionId,
      { selections: [{ candidateIndex: 0 }], scope: 'global' },
      () => {},
    )

    await expect(result).resolves.toEqual({ outcome: 'allow' })
    expect(policySpan.complete).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'allow',
      effectiveDecision: { outcome: 'allow', basis: 'approval.user-approved' },
    }))
  })

  it('审批请求携带结构化候选规则', async () => {
    const emitter = createMockEmitter()
    let resolveApproval!: (value: ApprovalResult) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<ApprovalResult>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval), {
      getRules: () => ({ global: [], workspace: [] }),
    })
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: {
        ...createPrepared(),
        toolName: 'github___create_issue',
        operationType: 'mcp',
        scope: 'external',
        input: { title: 'test' },
        serverName: 'github',
        originalToolName: 'create_issue',
      },
      config: { eventEmitter: emitter, logger: createMockLogger() },
    })

    expect(task.snapshot.pendingAction?.approvalCandidates).toBeDefined()
    expect(task.snapshot.pendingAction?.approvalCandidates?.candidates).toHaveLength(1)
    expect(task.snapshot.pendingAction?.approvalCandidates?.candidates[0]).toMatchObject({
      type: 'mcp-tool',
      serverName: 'github',
      toolName: 'create_issue',
    })

    resolveApproval({ approved: true })
    await resultPromise
  })

  it('browser 工具能生成持久规则候选，未知工具不生成', async () => {
    let resolveApproval!: (value: ApprovalResult) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<ApprovalResult>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval), {
      getRules: () => ({ global: [], workspace: [] }),
    })
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'browser_navigate', operationType: 'browser', scope: 'external', input: { url: 'https://github.com' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    // browser 工具现在生成候选
    expect(task.snapshot.pendingAction?.approvalCandidates).toBeDefined()
    expect(task.snapshot.pendingAction?.approvalCandidates?.candidates).toHaveLength(1)
    expect(task.snapshot.pendingAction?.approvalCandidates?.candidates[0]).toMatchObject({
      type: 'browser',
      toolName: 'browser_navigate',
    })

    resolveApproval({ approved: true })
    await resultPromise
  })

  it('browser_navigate 按域名匹配 allow 和 deny 规则', async () => {
    const allowRule: ToolApprovalRule = {
      id: 'browser-allow',
      createdAt: 1,
      updatedAt: 1,
      effect: 'allow',
      kind: 'browser',
      toolName: 'browser_navigate',
      urlPattern: '*.github.com',
    }
    const denyRule: ToolApprovalRule = {
      ...allowRule,
      id: 'browser-deny',
      effect: 'deny',
      urlPattern: 'admin.github.com',
    }
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval), createRulesProvider([allowRule, denyRule]))

    await expect(hook({
      task: createTask({ mode: 'strict' }),
      prepared: { ...createPrepared(), toolName: 'browser_navigate', operationType: 'browser', scope: 'external', input: { url: 'https://docs.github.com/path' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })

    await expect(hook({
      task: createTask({ mode: 'strict' }),
      prepared: { ...createPrepared(), toolName: 'browser_navigate', operationType: 'browser', scope: 'external', input: { url: 'https://admin.github.com/settings' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toMatchObject({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED' })
    expect(waitForApproval).not.toHaveBeenCalled()
  })
})
