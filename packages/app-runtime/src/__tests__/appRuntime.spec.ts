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

  it('applies the current workspace when creating and listing conversations', async () => {
    const workspacePath = runtime.workspace.getCurrentPath()
    const conversation = await runtime.chat.createConversation({
      title: 'Runtime conversation',
      createdAt: 1,
      updatedAt: 1,
      settings: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
      },
    })

    const result = await runtime.chat.listConversations(0, 20)

    expect(conversation.workspacePath).toBe(workspacePath)
    expect(result.total).toBe(1)
    expect(result.data).toEqual([expect.objectContaining({
      id: conversation.id,
      workspacePath,
      title: 'Runtime conversation',
    })])
  })

  it('emits domain events after settings and workspace changes', async () => {
    const settingsEvents: { keys: string[] }[] = []
    const workspaceEvents: { currentWorkspacePath: string }[] = []
    runtime.events.on('settings:updated', event => settingsEvents.push(event))
    runtime.events.on('workspace:changed', event => workspaceEvents.push(event))

    await runtime.settings.update({ assistantModelId: 'model-2' })
    const workspace = runtime.workspace.list().workspaces[0]
    runtime.workspace.open(workspace.path)

    expect(settingsEvents).toEqual([{ keys: ['assistantModelId'] }])
    expect(workspaceEvents).toEqual([{ currentWorkspacePath: workspace.path }])
  })

  it('clears all conversations in current workspace', async () => {
    await runtime.chat.createConversation({ title: 'Conv 1', createdAt: 1, updatedAt: 1, settings: { modelId: 'm', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })
    await runtime.chat.createConversation({ title: 'Conv 2', createdAt: 2, updatedAt: 2, settings: { modelId: 'm', systemPrompt: '', temperature: 0.7, maxTokens: 1024 } })

    const deletedIds = await runtime.chat.clearWorkspaceConversations()

    expect(deletedIds.length).toBe(2)
    const remaining = await runtime.chat.listConversations(0, 100)
    expect(remaining.total).toBe(0)
  })
})
