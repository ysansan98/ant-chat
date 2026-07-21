import type { AgentTaskSnapshot, IAgentEventEmitter, ILogger, ToolApprovalWhitelistEntry } from '@ant-chat/shared'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeTask } from '../../taskStore'
import { TaskStore } from '../../taskStore'
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

function createTaskState(waitForApproval: (task: RuntimeTask) => Promise<{ approved: boolean, reason?: string, remember?: 'workspace' | 'global' }>): TaskStore {
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

  it('普通交互的严格只读 Bash 直接放行，其他 Bash 仍需审批', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({ mode: 'hybrid' })

    await expect(hook({
      task,
      prepared: { ...createPrepared(), toolName: 'bash', operationType: 'bash_read', input: { command: 'which node && node --version' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })
    expect(waitForApproval).not.toHaveBeenCalled()

    await expect(hook({
      task: createTask({ mode: 'hybrid' }),
      prepared: { ...createPrepared(), toolName: 'bash', operationType: 'bash', input: { command: 'git status' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })
    expect(waitForApproval).toHaveBeenCalledOnce()
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

  it('工具能力与资源域不一致时任何模式都直接阻断', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))

    await expect(hook({
      task: createTask({ mode: 'full_managed' }),
      prepared: { ...createPrepared(), toolName: 'github__list_issues', operationType: 'mcp', scope: 'outside' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toMatchObject({ outcome: 'block', reason: '工具能力与资源域不一致' })
  })

  it('自动化只在显式授权后允许调用所选 MCP 工具', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const createAutomationTask = (allowMcpTools: boolean) => createTask({
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        allowedSkills: [],
        allowedMcpServers: ['github'],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSelectedSkillRuntime: false,
          allowBrowser: false,
          allowMcpTools,
          extraFileRoots: [],
          allowBashCommands: false,
          bashCommandPatterns: [],
        },
      },
    })
    const prepared = { ...createPrepared(), toolName: 'github__create_issue', operationType: 'mcp' as const, scope: 'external' as const }

    await expect(hook({
      task: createAutomationTask(false),
      prepared,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toMatchObject({ outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED' })
    await expect(hook({
      task: createAutomationTask(true),
      prepared,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })
  })

  it('自动化只在显式授权后允许普通浏览器操作', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const createAutomationTask = (allowBrowser: boolean) => createTask({
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        allowedSkills: [],
        allowedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSelectedSkillRuntime: false,
          allowBrowser,
          allowMcpTools: false,
          extraFileRoots: [],
          allowBashCommands: false,
          bashCommandPatterns: [],
        },
      },
    })
    const prepared = { ...createPrepared(), toolName: 'browser', operationType: 'browser' as const, scope: 'external' as const }

    await expect(hook({
      task: createAutomationTask(false),
      prepared,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toMatchObject({ outcome: 'block', reason: '自动化任务未授权浏览器操作' })
    await expect(hook({
      task: createAutomationTask(true),
      prepared,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })
  })

  it('自动化即使允许浏览器也不能复用系统 Chrome Profile', async () => {
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
          allowBrowser: true,
          allowMcpTools: false,
          extraFileRoots: [],
          allowBashCommands: false,
          bashCommandPatterns: [],
        },
      },
    })

    await expect(hook({
      task,
      prepared: { ...createPrepared(), toolName: 'browser', operationType: 'browser', scope: 'outside' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toMatchObject({ outcome: 'block', reason: '自动化任务不允许复用系统浏览器身份' })
  })

  it('交互任务访问外部服务时进入人工审批', async () => {
    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const hook = createToolAuthorization(createTaskState(waitForApproval))

    await expect(hook({
      task: createTask({ mode: 'hybrid' }),
      prepared: { ...createPrepared(), toolName: 'browser', operationType: 'browser', scope: 'external' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })
    expect(waitForApproval).toHaveBeenCalledOnce()
  })

  it('outside scope 设置 pendingAction 并等待审批', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'outside' },
      config: { eventEmitter: emitter, logger },
    })

    // Should be awaiting approval
    expect(task.snapshot.status).toBe('awaiting_approval')
    expect(task.snapshot.pendingAction).toBeDefined()
    expect(task.snapshot.pendingAction?.toolName).toBe('read_file')
    expect(emitter.emitTaskUpdated).toHaveBeenCalled()
    expect(emitter.emitApprovalRequired).toHaveBeenCalled()

    // Approve
    resolveApproval({ approved: true })
    const result = await resultPromise
    expect(result).toEqual({ outcome: 'allow' })
  })

  it('审批被拒绝时返回 block', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), operationType: 'write', scope: 'workspace' },
      config: { eventEmitter: emitter, logger },
    })

    // Reject
    resolveApproval({ approved: false, reason: 'User denied' })
    const result = await resultPromise

    expect(result.outcome).toBe('block')
    if (result.outcome === 'block') {
      expect(result.reason).toContain('rejected')
    }
  })

  it('审批期间任务中止时抛出 AGENT_CANCELLED', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const waitForApproval = vi.fn().mockImplementation((t: RuntimeTask) => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        t.abortController.abort()
        resolve({ approved: false, reason: 'AGENT_CANCELLED' })
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({ mode: 'strict' })

    await expect(
      hook({
        task,
        prepared: { ...createPrepared(), operationType: 'bash', scope: 'workspace' },
        config: { eventEmitter: emitter, logger },
      }),
    ).rejects.toThrow('任务已取消')
  })

  it('记录 allow 决策', async () => {
    const hook = createToolAuthorization(createTaskState(async () => ({ approved: true })))
    const task = createTask({ mode: 'hybrid' })
    const span = { id: 'mock', complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() }
    const turnRecorder = { startModelRequest: vi.fn(() => span), startToolCall: vi.fn(() => span), startPolicyDecision: vi.fn(() => span), recordContextEvent: vi.fn(), finish: vi.fn() }

    const result = await hook({
      task,
      prepared: { ...createPrepared(), operationType: 'read', scope: 'workspace' },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger(), turnRecorder },
    })

    expect(result).toEqual({ outcome: 'allow' })
    expect(span.complete).toHaveBeenCalledWith(expect.objectContaining({ status: 'allow', outcome: 'allow' }))
  })

  it('精确记忆授权匹配时自动批准', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const whitelist: ToolApprovalWhitelistEntry[] = [{
      toolName: 'write_file',
      operationType: 'write',
      toolScope: 'workspace',
      pattern: '/workspace/src/index.ts',
      description: '允许写入 src',
    }]

    const hook = createToolAuthorization(
      createTaskState(async () => ({ approved: true })),
      { getEntries: () => whitelist },
    )
    const task = createTask({ mode: 'strict' })

    const result = await hook({
      task,
      prepared: { ...createPrepared(), toolName: 'write_file', operationType: 'write', scope: 'workspace', input: { path: '/workspace/src/index.ts' } },
      config: { eventEmitter: emitter, logger },
    })

    expect(result).toEqual({ outcome: 'allow' })
    expect(emitter.emitApprovalRequired).not.toHaveBeenCalled()
    expect(task.snapshot.status).toBe('running')
  })

  it('记忆授权不匹配时仍请求审批', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    const whitelist: ToolApprovalWhitelistEntry[] = [{
      toolName: 'write_file',
      operationType: 'write',
      toolScope: 'workspace',
      pattern: '/safe-path/**',
      description: '允许写入安全目录',
    }]

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval), { getEntries: () => whitelist })
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'write_file', operationType: 'write', scope: 'workspace', input: { path: '/workspace/src/index.ts' } },
      config: { eventEmitter: emitter, logger },
    })

    expect(task.snapshot.status).toBe('awaiting_approval')
    resolveApproval({ approved: true })
    const result = await resultPromise
    expect(result).toEqual({ outcome: 'allow' })
  })

  it('全局文件授权仍绑定同一个绝对资源', async () => {
    const entries: ToolApprovalWhitelistEntry[] = []
    const firstHook = createToolAuthorization(
      createTaskState(async (task) => {
        entries.push(task.snapshot.pendingAction!.approvalGrant!)
        return { approved: true }
      }),
      { getEntries: () => entries },
    )
    const prepared = { ...createPrepared(), toolName: 'write_file', operationType: 'write' as const, scope: 'workspace' as const, input: { path: './src/index.ts' } }

    await firstHook({
      task: createTask({ mode: 'strict' }),
      prepared,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })
    expect(entries[0]?.pattern).toBe('/workspace/src/index.ts')

    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const nextHook = createToolAuthorization(createTaskState(waitForApproval), { getEntries: () => entries })
    await nextHook({
      task: createTask({ mode: 'strict', workspacePath: '/other-workspace' }),
      prepared,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })
    expect(waitForApproval).toHaveBeenCalledOnce()
  })

  it('审批请求携带具体的记忆授权能力', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval), { getEntries: () => [] })
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'bash', operationType: 'bash', scope: 'workspace', input: { command: 'git log' } },
      config: { eventEmitter: emitter, logger },
    })

    expect(task.snapshot.pendingAction?.approvalGrant).toMatchObject({
      toolName: 'bash',
      operationType: 'bash',
      description: '允许执行命令 git log',
    })

    resolveApproval({ approved: true })
    await resultPromise
  })

  it('未提供 getWhitelistEntries 时保持兼容行为', async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()

    let resolveApproval!: (value: { approved: boolean, reason?: string }) => void
    const waitForApproval = vi.fn().mockImplementation(() => {
      return new Promise<{ approved: boolean, reason?: string }>((resolve) => {
        resolveApproval = resolve
      })
    })

    const hook = createToolAuthorization(createTaskState(waitForApproval))
    const task = createTask({ mode: 'strict' })

    const resultPromise = hook({
      task,
      prepared: { ...createPrepared(), operationType: 'write', scope: 'workspace' },
      config: { eventEmitter: emitter, logger },
    })

    expect(task.snapshot.status).toBe('awaiting_approval')
    resolveApproval({ approved: true })
    const result = await resultPromise
    expect(result).toEqual({ outcome: 'allow' })
  })

  it('记住 Node 脚本后只放行同一脚本，不扩大为任意 Node 命令', async () => {
    const entries: ToolApprovalWhitelistEntry[] = []
    const grants = { getEntries: () => entries }
    const firstHook = createToolAuthorization(
      createTaskState(async (task) => {
        entries.push(task.snapshot.pendingAction!.approvalGrant!)
        return { approved: true, remember: 'global' }
      }),
      grants,
    )
    const prepared = {
      ...createPrepared(),
      toolName: 'bash',
      operationType: 'bash' as const,
      scope: 'outside' as const,
      input: { command: 'node meituan/run.js init', cwd: 'skills' },
    }

    await expect(firstHook({
      task: createTask({ mode: 'strict' }),
      prepared,
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      description: expect.stringContaining('执行脚本 /workspace/skills/meituan/run.js'),
    })

    const waitForApproval = vi.fn(async () => ({ approved: true }))
    const nextHook = createToolAuthorization(createTaskState(waitForApproval), grants)
    await expect(nextHook({
      task: createTask({ mode: 'strict' }),
      prepared: { ...prepared, input: { command: 'node meituan/run.js issue', cwd: 'skills' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })).resolves.toEqual({ outcome: 'allow' })
    expect(waitForApproval).not.toHaveBeenCalled()

    await nextHook({
      task: createTask({ mode: 'strict' }),
      prepared: { ...prepared, input: { command: 'node other/run.js issue', cwd: 'skills' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })
    await nextHook({
      task: createTask({ mode: 'strict', workspacePath: '/other-workspace' }),
      prepared: { ...prepared, input: { command: 'node meituan/run.js issue', cwd: 'skills' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })
    await nextHook({
      task: createTask({ mode: 'strict' }),
      prepared: { ...prepared, input: { command: '/tmp/attacker/node meituan/run.js issue', cwd: 'skills' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })
    expect(waitForApproval).toHaveBeenCalledTimes(3)
  })

  it('执行路径解析到其他 Node 解释器后不复用原授权', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-node-grant-'))
    try {
      const firstBin = path.join(root, 'first-bin')
      const secondBin = path.join(root, 'second-bin')
      fs.mkdirSync(firstBin)
      fs.mkdirSync(secondBin)
      fs.writeFileSync(path.join(firstBin, 'node'), '')
      fs.writeFileSync(path.join(secondBin, 'node'), '')
      fs.chmodSync(path.join(firstBin, 'node'), 0o755)
      fs.chmodSync(path.join(secondBin, 'node'), 0o755)
      const entries: ToolApprovalWhitelistEntry[] = []
      const prepared = { ...createPrepared(), toolName: 'bash', operationType: 'bash' as const, scope: 'outside' as const, input: { command: 'node scripts/run.js init' } }
      const firstHook = createToolAuthorization(createTaskState(async (task) => {
        entries.push(task.snapshot.pendingAction!.approvalGrant!)
        return { approved: true }
      }), { getEntries: () => entries })
      await firstHook({
        task: createTask({ mode: 'strict' }),
        prepared,
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger(), bashEnvironment: { PATH: firstBin } },
      })

      const waitForApproval = vi.fn(async () => ({ approved: true }))
      const nextHook = createToolAuthorization(createTaskState(waitForApproval), { getEntries: () => entries })
      await nextHook({
        task: createTask({ mode: 'strict' }),
        prepared,
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger(), bashEnvironment: { PATH: secondBin } },
      })

      expect(waitForApproval).toHaveBeenCalledOnce()
    }
    finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('符号链接父目录改靶后不复用新建文件授权', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-file-grant-'))
    try {
      const workspacePath = path.join(root, 'workspace')
      const firstTarget = path.join(root, 'first-target')
      const secondTarget = path.join(root, 'second-target')
      const linkPath = path.join(workspacePath, 'linked')
      fs.mkdirSync(workspacePath)
      fs.mkdirSync(firstTarget)
      fs.mkdirSync(secondTarget)
      fs.symlinkSync(firstTarget, linkPath, 'dir')
      const entries: ToolApprovalWhitelistEntry[] = []
      const prepared = { ...createPrepared(), toolName: 'write_file', operationType: 'write' as const, scope: 'outside' as const, input: { path: 'linked/new.txt' } }
      const firstHook = createToolAuthorization(createTaskState(async (task) => {
        entries.push(task.snapshot.pendingAction!.approvalGrant!)
        return { approved: true }
      }), { getEntries: () => entries })
      await firstHook({
        task: createTask({ mode: 'strict', workspacePath }),
        prepared,
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      })
      expect(entries[0]?.pattern).toBe(path.join(fs.realpathSync.native(firstTarget), 'new.txt'))

      fs.unlinkSync(linkPath)
      fs.symlinkSync(secondTarget, linkPath, 'dir')
      const waitForApproval = vi.fn(async () => ({ approved: true }))
      const nextHook = createToolAuthorization(createTaskState(waitForApproval), { getEntries: () => entries })
      await nextHook({
        task: createTask({ mode: 'strict', workspacePath }),
        prepared,
        config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
      })

      expect(waitForApproval).toHaveBeenCalledOnce()
    }
    finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('错误 actionId 不会提前写入记忆授权', async () => {
    const taskStore = new TaskStore()
    const task = createTask({ mode: 'strict' })
    taskStore.reserve(task)
    const addEntry = vi.fn()
    const hook = createToolAuthorization(taskStore, { getEntries: () => [] })
    const result = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'bash', operationType: 'bash', scope: 'outside', input: { command: 'git log' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })
    await vi.waitFor(() => expect(task.snapshot.pendingAction).toBeDefined())

    expect(() => taskStore.approve(task.snapshot.taskId, 'stale-action', 'global', grant => addEntry(grant)))
      .toThrow('Approval action mismatch')
    expect(addEntry).not.toHaveBeenCalled()

    taskStore.approve(task.snapshot.taskId, task.snapshot.pendingAction!.actionId, 'workspace', (grant, workspacePath) => addEntry({ ...grant, workspacePath }))
    await expect(result).resolves.toEqual({ outcome: 'allow' })
    expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: '/workspace' }))
  })

  it('记忆授权持久化失败时不返回允许执行', async () => {
    const taskStore = new TaskStore()
    const task = createTask({ mode: 'strict' })
    taskStore.reserve(task)
    const hook = createToolAuthorization(taskStore, { getEntries: () => [] })
    const result = hook({
      task,
      prepared: { ...createPrepared(), toolName: 'bash', operationType: 'bash', scope: 'outside', input: { command: 'git log' } },
      config: { eventEmitter: createMockEmitter(), logger: createMockLogger() },
    })
    await vi.waitFor(() => expect(task.snapshot.pendingAction).toBeDefined())

    expect(() => taskStore.approve(task.snapshot.taskId, task.snapshot.pendingAction!.actionId, 'global', () => {
      throw new Error('settings write failed')
    })).toThrow('settings write failed')
    expect(task.snapshot.status).toBe('awaiting_approval')
    expect(task.snapshot.pendingAction).toBeDefined()

    taskStore.reject(task.snapshot.taskId, task.snapshot.pendingAction!.actionId, '持久化失败')
    await expect(result).resolves.toMatchObject({ outcome: 'block' })
  })
})
