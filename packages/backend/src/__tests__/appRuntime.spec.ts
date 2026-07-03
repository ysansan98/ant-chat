import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { createAppRuntime as createAppRuntimeFn } from '../appRuntime'

vi.mock('keytar', () => ({
  default: {
    setPassword: vi.fn(),
    getPassword: vi.fn(async () => null),
    deletePassword: vi.fn(async () => true),
  },
}))

describe('app runtime', () => {
  let appDataRoot: string
  let runtime: ReturnType<typeof createAppRuntimeFn>

  beforeEach(async () => {
    const { createAppRuntime } = await import('../appRuntime')
    appDataRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-app-runtime-'))
    runtime = createAppRuntime({
      appDataRoot,
    })
    await runtime.initialize()
  })

  afterEach(async () => {
    await runtime.dispose()
    rmSync(appDataRoot, { force: true, recursive: true })
    vi.clearAllMocks()
  })

  it('createConversation 必传 workspacePath,未传时抛错', async () => {
    await expect(runtime.invoke('chat.addConversation', {
      conversation: {
        title: 'no workspace',
        createdAt: 1,
        updatedAt: 1,
        settings: { modelId: 'model-1', providerId: 'provider-1', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
      } as any,
    })).rejects.toThrow('workspacePath is required')
  })

  it('createConversation 传入 workspacePath 时归属该工作区', async () => {
    const workspacePath = await runtime.invoke('workspace.getDefaultWorkspacePath', undefined)
    const conversation = await runtime.invoke('chat.addConversation', {
      conversation: {
        title: 'explicit workspace',
        createdAt: 1,
        updatedAt: 1,
        workspacePath,
        settings: { modelId: 'model-1', providerId: 'provider-1', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
      },
    })

    expect(conversation.workspacePath).toBe(workspacePath)
    const result = await runtime.invoke('chat.getWorkspaceConversations', { pageIndex: 0, pageSize: 20, workspacePath })
    expect(result.data).toEqual([expect.objectContaining({ id: conversation.id, workspacePath })])
  })

  it('listConversations 未传 workspacePath 时返回跨工作区全量', async () => {
    const defaultPath = await runtime.invoke('workspace.getDefaultWorkspacePath', undefined)
    await runtime.invoke('chat.addConversation', {
      conversation: {
        title: 'in default',
        createdAt: 1,
        updatedAt: 1,
        workspacePath: defaultPath,
        settings: { modelId: 'm', providerId: 'p', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
      },
    })

    const result = await runtime.invoke('chat.getConversations', { pageIndex: 0, pageSize: 100 })

    // 全量查询:不依赖 currentWorkspacePath 兜底,返回所有会话
    expect(result.total).toBeGreaterThanOrEqual(1)
  })

  it('workspace:changed 事件 payload 为空对象', async () => {
    const workspaceEvents: Record<string, never>[] = []
    runtime.events.on('workspace:changed', event => workspaceEvents.push(event))

    const workspace = (await runtime.invoke('workspace.listWorkspaces', undefined)).workspaces[0]
    await runtime.invoke('workspace.openWorkspace', { path: workspace.path })

    expect(workspaceEvents).toEqual([{}])
  })

  it('clearWorkspaceConversations 必传 workspacePath', async () => {
    const defaultPath = await runtime.invoke('workspace.getDefaultWorkspacePath', undefined)
    await runtime.invoke('chat.addConversation', {
      conversation: {
        title: 'to clear',
        createdAt: 1,
        updatedAt: 1,
        workspacePath: defaultPath,
        settings: { modelId: 'm', providerId: 'p', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
      },
    })

    await expect(runtime.invoke('chat.clearWorkspaceConversations', { workspacePath: undefined as any })).rejects.toThrow('workspacePath is required')

    const deletedIds = await runtime.invoke('chat.clearWorkspaceConversations', { workspacePath: defaultPath })
    expect(deletedIds.length).toBe(1)
  })

  it('searchFiles 必传 workspacePath', async () => {
    const defaultPath = await runtime.invoke('workspace.getDefaultWorkspacePath', undefined)
    const results = await runtime.invoke('workspace.searchWorkspaceFiles', { workspacePath: defaultPath, query: '', limit: 10 })
    expect(Array.isArray(results)).toBe(true)
  })

  it('重启运行时后仍能读取自动化定义', async () => {
    const workspacePath = await runtime.invoke('workspace.getDefaultWorkspacePath', undefined)
    const created = await runtime.invoke('automation.create', {
      input: {
        name: '明日检查',
        prompt: '检查项目状态',
        workspacePath,
        providerId: 'provider-1',
        modelId: 'model-1',
        selectedSkills: [],
        selectedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSkillScripts: false,
          allowMcpMutations: false,
          extraFileRoots: [],
          allowArbitraryCommands: false,
          commandPatterns: [],
          allowNetwork: false,
        },
        schedule: { type: 'once', runAt: Date.now() + 60_000 },
        enabled: true,
      },
    })

    await runtime.dispose()
    const { createAppRuntime } = await import('../appRuntime')
    runtime = createAppRuntime({ appDataRoot })
    await runtime.initialize()

    await expect(runtime.invoke('automation.list', undefined)).resolves.toEqual([
      expect.objectContaining({ id: created.id, name: '明日检查' }),
    ])
  })
})
