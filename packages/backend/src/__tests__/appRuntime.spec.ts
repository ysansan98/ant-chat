import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { activateAppRuntime as activateAppRuntimeFn } from '../appRuntime'

vi.mock('keytar', () => ({
  default: {
    setPassword: vi.fn(),
    getPassword: vi.fn(async () => null),
    deletePassword: vi.fn(async () => true),
  },
}))

describe('app runtime', () => {
  let appDataRoot: string
  let runtime: Awaited<ReturnType<typeof activateAppRuntimeFn>>

  beforeEach(async () => {
    const { activateAppRuntime } = await import('../appRuntime')
    appDataRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-app-runtime-'))
    runtime = await activateAppRuntime({
      appDataRoot,
    })
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
      } as any,
    })).rejects.toThrow('缺少工作区路径')
  })

  it('createConversation 传入 workspacePath 时归属该工作区', async () => {
    const workspacePath = await runtime.invoke('workspace.getDefaultWorkspacePath', undefined)
    const conversation = await runtime.invoke('chat.addConversation', {
      conversation: {
        title: 'explicit workspace',
        createdAt: 1,
        updatedAt: 1,
        settings: { modelId: '', providerId: '', temperature: 0, maxOutputTokens: 0 },
        conversationInstructions: '',
        workspacePath,
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
        settings: { modelId: '', providerId: '', temperature: 0, maxOutputTokens: 0 },
        conversationInstructions: '',
        workspacePath: defaultPath,
      },
    })

    const result = await runtime.invoke('chat.getConversations', { pageIndex: 0, pageSize: 100 })

    // 全量查询:不依赖 currentWorkspacePath 兜底,返回所有会话
    expect(result.total).toBeGreaterThanOrEqual(1)
  })

  it('归档会话后普通列表隐藏，恢复时保留更新时间', async () => {
    const workspacePath = await runtime.invoke('workspace.getDefaultWorkspacePath', undefined)
    const conversation = await runtime.invoke('chat.addConversation', {
      conversation: {
        title: '待归档',
        createdAt: 10,
        updatedAt: 20,
        settings: { modelId: '', providerId: '', temperature: 0, maxOutputTokens: 0 },
        conversationInstructions: '',
        workspacePath,
      },
    })
    const otherConversation = await runtime.invoke('chat.addConversation', {
      conversation: {
        title: '其他归档',
        createdAt: 5,
        updatedAt: 10,
        settings: { modelId: '', providerId: '', temperature: 0, maxOutputTokens: 0 },
        conversationInstructions: '',
        workspacePath,
      },
    })

    await expect(runtime.invoke('chat.archiveConversation', { id: conversation.id }))
      .resolves
      .toMatchObject({ id: conversation.id, archived: true })
    await runtime.invoke('chat.archiveConversation', { id: otherConversation.id })
    await expect(runtime.invoke('chat.getWorkspaceConversations', { pageIndex: 0, pageSize: 20, workspacePath }))
      .resolves
      .toEqual({ data: [], total: 0 })
    const archivedGroups = await runtime.invoke('chat.getArchivedConversationWorkspaces', { query: '待归', pageSize: 20 } as never) as any
    expect(archivedGroups).toEqual({
      total: 2,
      workspaces: [{
        workspacePath,
        displayName: path.basename(workspacePath),
        total: 2,
        matchedTotal: 1,
        available: true,
        conversations: [expect.objectContaining({ id: conversation.id, title: '待归档' })],
      }],
    })

    const restored = await runtime.invoke('chat.restoreConversation', { id: conversation.id })
    expect(restored).toMatchObject({ id: conversation.id, archived: false, updatedAt: 20 })
  })

  it('恢复已移除工作区的归档会话时重新加入原工作区', async () => {
    const requestedPath = path.join(appDataRoot, 'restored-workspace')
    mkdirSync(requestedPath)
    const added = await runtime.invoke('workspace.addWorkspace', { path: requestedPath })
    const workspacePath = added.workspaces.find(item => item.displayName === 'restored-workspace')!.path
    const conversation = await runtime.invoke('chat.addConversation', {
      conversation: {
        title: '恢复工作区',
        createdAt: 1,
        updatedAt: 1,
        settings: { modelId: '', providerId: '', temperature: 0, maxOutputTokens: 0 },
        conversationInstructions: '',
        workspacePath,
      },
    })
    await runtime.invoke('chat.archiveConversation', { id: conversation.id })
    await runtime.invoke('workspace.removeWorkspace', { path: workspacePath })

    await runtime.invoke('chat.restoreConversation', { id: conversation.id })

    const workspaces = await runtime.invoke('workspace.listWorkspaces', undefined)
    expect(workspaces.workspaces.map(item => item.path)).toContain(workspacePath)
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
        settings: { modelId: '', providerId: '', temperature: 0, maxOutputTokens: 0 },
        conversationInstructions: '',
        workspacePath: defaultPath,
      },
    })

    await expect(runtime.invoke('chat.clearWorkspaceConversations', { workspacePath: undefined as any })).rejects.toThrow('缺少工作区路径')

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
        schedule: { type: 'once', runAt: Date.now() + 60_000 },
        enabled: true,
      },
    })

    await runtime.dispose()
    const { activateAppRuntime } = await import('../appRuntime')
    runtime = await activateAppRuntime({ appDataRoot })

    await expect(runtime.invoke('automation.list', undefined)).resolves.toEqual([
      expect.objectContaining({ id: created.id, name: '明日检查' }),
    ])
  })

  it('同一数据目录的第二次激活失败且不破坏活跃 Runtime', async () => {
    const { activateAppRuntime } = await import('../appRuntime')

    await expect(activateAppRuntime({ appDataRoot })).rejects.toMatchObject({ code: 'EADDRINUSE' })
    await expect(runtime.invoke('workspace.listWorkspaces', undefined)).resolves.toEqual(expect.objectContaining({
      workspaces: expect.any(Array),
    }))
    await expect(activateAppRuntime({ appDataRoot })).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })
})
