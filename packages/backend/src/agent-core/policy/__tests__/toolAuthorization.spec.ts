import type { AgentTaskSnapshot, IAgentEventEmitter, ILogger, ToolApprovalRule } from '@ant-chat/shared'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeTask } from '../../taskStore'
import { TaskStore } from '../../taskStore'
import { ToolRegistry } from '../../tools/toolRegistry'
import { parseBashCommand } from '../../native-tools/tools/bashCommandParser'
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
      workspacePath: '/workspace',
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
          allowBashCommands: false,
          bashCommandPatterns: [],
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
          allowBashCommands: false,
          bashCommandPatterns: [],
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

  it('自动化仅在启用 Bash 后允许只读 Bash 探测', async () => {
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
          allowBashCommands: true,
          bashCommandPatterns: [],
        },
      },
    })

    await expect(hook({
      task,
      prepared: { ...createPrepared(), toolName: 'bash', operationType: 'bash_read', input: { command: 'which node && node --version' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })
  })

  it('自动化未启用 Bash 时阻止只读 Bash 探测', async () => {
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
          allowBashCommands: false,
          bashCommandPatterns: [],
        },
      },
    })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), toolName: 'bash', operationType: 'bash_read', input: { command: 'which node && node --version' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    expect(result).toEqual(expect.objectContaining({ outcome: 'block', reason: '自动化任务未授权命令执行' }))
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

  it('黑名单优先于白名单和完全访问权限，且仅阻止工具调用', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-deny-rule-'))
    try {
      const command = 'git status | cat'
      const parsed = parseBashCommand({ command }, workspacePath)
      const rules = createRulesProvider([
        {
          id: 'allow-git',
          kind: 'bash-command',
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
          kind: 'bash-command',
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
        prepared: {
          ...createPrepared(),
          toolName: 'bash',
          input: { command },
          operationType: 'bash_read',
          scope: 'outside',
          preparedState: { kind: 'bash', parsed },
        },
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

  it('复杂 shell 语法即使在完全访问权限模式也必须等待本次审批', async () => {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-shell-approval-'))
    try {
      const parsed = parseBashCommand({ command: 'git diff | head -20' }, workspacePath)
      const waitForApproval = vi.fn(async () => ({ approved: true }))
      const hook = createToolAuthorization(createTaskState(waitForApproval))

      await expect(hook({
        task: createTask({ mode: 'full_managed', workspacePath }),
        prepared: {
          ...createPrepared(),
          toolName: 'bash',
          input: { command: 'git diff | head -20' },
          operationType: 'bash',
          scope: 'outside',
          preparedState: { kind: 'bash', parsed },
        },
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      })).resolves.toEqual({ outcome: 'allow' })

      expect(waitForApproval).toHaveBeenCalledTimes(1)
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
      prepared: { ...createPrepared(), toolName: 'browser', operationType: 'browser', scope: 'workspace' },
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
          allowBashCommands: false,
          bashCommandPatterns: [],
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
          allowBashCommands: false,
          bashCommandPatterns: [],
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

  it('复合 Bash 审批只展示未被规则覆盖的命令段', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-partial-bash-rule-'))
    try {
      const command = 'git checkout main && node scripts/run.js'
      const parsed = parseBashCommand({ command }, root)
      const rules = createRulesProvider([{
        id: 'allow-git-checkout',
        kind: 'bash-command',
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
        prepared: {
          ...createPrepared(),
          toolName: 'bash',
          input: { command },
          operationType: 'bash',
          scope: 'workspace',
          preparedState: { kind: 'bash', parsed },
        },
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      })

      expect(task.snapshot.pendingAction?.approvalCandidates?.candidates).toEqual([
        expect.objectContaining({
          type: 'bash-segment',
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

  it('复合 Bash 被多条规则共同覆盖时 Trace 记录全部命中规则', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-bash-rule-trace-'))
    try {
      const command = 'git checkout main && node scripts/run.js'
      const parsed = parseBashCommand({ command }, root)
      const rules = createRulesProvider(
        [{
          id: 'allow-git-checkout',
          kind: 'bash-command',
          executable: 'git',
          argvPrefix: ['checkout', 'main'],
          allowRemainingArgs: false,
          resourceScope: 'workspace',
          createdAt: 0,
          updatedAt: 0,
        }],
        [{
          id: 'allow-node-run',
          kind: 'bash-command',
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
        prepared: {
          ...createPrepared(),
          toolName: 'bash',
          input: { command },
          operationType: 'bash',
          scope: 'workspace',
          preparedState: { kind: 'bash', parsed },
        },
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
          { ruleId: 'allow-git-checkout', kind: 'bash-command', effect: 'allow', group: 'global' },
          { ruleId: 'allow-node-run', kind: 'bash-command', effect: 'allow', group: 'workspace' },
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

  it('bash 准备态生成的候选可直接匹配规则并执行同一命令', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-bash-rule-'))
    try {
      const registry = await ToolRegistry.create({
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
        workspacePath: root,
        mode: 'strict',
        turnSource: { type: 'interactive' },
      })
      const prepared = registry.prepare('bash', { command: 'node -e "console.log(1)"' })
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
        type: 'bash-segment',
        argvPrefix: ['-e', 'console.log(1)'],
        resourceScope: 'workspace',
      })
      if (!candidate || candidate.type !== 'bash-segment') {
        throw new Error('缺少 Bash 审批候选')
      }
      resolveApproval({ approved: true })
      await expect(firstResult).resolves.toEqual({ outcome: 'allow' })

      const rule: ToolApprovalRule = {
        id: 'bash-rule-1',
        kind: 'bash-command',
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
      const secondPrepared = registry.prepare('bash', { command: 'node -e "console.log(1)"' })

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

  it('browser 和未知工具不生成持久规则候选', async () => {
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
      prepared: { ...createPrepared(), toolName: 'browser', operationType: 'browser', scope: 'external', input: { command: 'navigate' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })

    // Browser 不生成候选
    expect(task.snapshot.pendingAction?.approvalCandidates).toBeUndefined()

    resolveApproval({ approved: true })
    await resultPromise
  })
})
