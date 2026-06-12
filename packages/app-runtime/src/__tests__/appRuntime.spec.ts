import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppRuntime } from '../appRuntime'

describe.skipIf(!canRunDbIntegrationTests())('app runtime', () => {
  let appDataRoot: string
  let runtime: ReturnType<typeof createAppRuntime>

  beforeEach(async () => {
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
})

function canRunDbIntegrationTests(): boolean {
  const probe = spawnSync(process.execPath, [
    '-e',
    'const Database = require("better-sqlite3"); const db = new Database(":memory:"); db.close()',
  ], {
    cwd: process.cwd(),
    stdio: 'ignore',
  })
  return probe.status === 0
}
