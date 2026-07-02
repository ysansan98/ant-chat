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
    await expect(runtime.chat.createConversation({
      title: 'no workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: { modelId: 'model-1', providerId: 'provider-1', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
    } as any)).rejects.toThrow('workspacePath is required')
  })

  it('createConversation 传入 workspacePath 时归属该工作区', async () => {
    const workspacePath = runtime.workspace.getDefaultPath()
    const conversation = await runtime.chat.createConversation({
      title: 'explicit workspace',
      createdAt: 1,
      updatedAt: 1,
      workspacePath,
      settings: { modelId: 'model-1', providerId: 'provider-1', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
    })

    expect(conversation.workspacePath).toBe(workspacePath)
    const result = await runtime.chat.listConversations(0, 20, workspacePath)
    expect(result.data).toEqual([expect.objectContaining({ id: conversation.id, workspacePath })])
  })

  it('listConversations 未传 workspacePath 时返回跨工作区全量', async () => {
    const defaultPath = runtime.workspace.getDefaultPath()
    await runtime.chat.createConversation({
      title: 'in default',
      createdAt: 1,
      updatedAt: 1,
      workspacePath: defaultPath,
      settings: { modelId: 'm', providerId: 'p', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
    })

    const result = await runtime.chat.listConversations(0, 100)

    // 全量查询:不依赖 currentWorkspacePath 兜底,返回所有会话
    expect(result.total).toBeGreaterThanOrEqual(1)
  })

  it('workspace:changed 事件 payload 为空对象', async () => {
    const workspaceEvents: Record<string, never>[] = []
    runtime.events.on('workspace:changed', event => workspaceEvents.push(event))

    const workspace = runtime.workspace.list().workspaces[0]
    runtime.workspace.open(workspace.path)

    expect(workspaceEvents).toEqual([{}])
  })

  it('clearWorkspaceConversations 必传 workspacePath', async () => {
    const defaultPath = runtime.workspace.getDefaultPath()
    await runtime.chat.createConversation({
      title: 'to clear',
      createdAt: 1,
      updatedAt: 1,
      workspacePath: defaultPath,
      settings: { modelId: 'm', providerId: 'p', systemPrompt: '', temperature: 0.7, maxTokens: 1024 },
    })

    await expect(runtime.chat.clearWorkspaceConversations(undefined as any)).rejects.toThrow('workspacePath is required')

    const deletedIds = await runtime.chat.clearWorkspaceConversations(defaultPath)
    expect(deletedIds.length).toBe(1)
  })

  it('searchFiles 必传 workspacePath', async () => {
    const defaultPath = runtime.workspace.getDefaultPath()
    const results = await runtime.workspace.searchFiles(defaultPath, '', 10)
    expect(Array.isArray(results)).toBe(true)
  })
})
