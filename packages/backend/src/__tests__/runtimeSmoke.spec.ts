import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { activateAppRuntime } from '../appRuntime'
import type { AppRuntime } from '../appRuntime'

describe('真实运行时冒烟：消息写入、前端搜索与记忆目录 RPC', () => {
  let runtime: AppRuntime
  let root: string
  let workspace: string

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'ant-chat-runtime-smoke-'))
    workspace = path.join(root, 'ws')
    mkdirSync(workspace, { recursive: true })
    writeFileSync(path.join(workspace, 'README.md'), '# smoke')
    runtime = await activateAppRuntime({
      appDataRoot: root,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    })
  })

  afterAll(async () => {
    await runtime.dispose()
    rmSync(root, { force: true, recursive: true })
  })

  it('v9 迁移随运行时启动生效，消息写入后投影与 FTS 可用，前端搜索不受影响', async () => {
    const conversation = await runtime.invoke('chat.addConversation', {
      conversation: {
        title: '冒烟会话',
        workspacePath: workspace,
        conversationInstructions: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        settings: { modelId: 'm', providerId: 'p' },
      },
    })
    const first = await runtime.invoke('chat.addMessage', {
      message: {
        id: `msg-smoke-${Date.now()}-1`,
        convId: conversation.id,
        role: 'user',
        status: 'success',
        createdAt: Date.now(),
        content: [{ type: 'text', text: '部署流程需要完整跑 pnpm check smoke-token-42' }],
      } as never,
    })
    await runtime.invoke('chat.addMessage', {
      message: {
        id: `msg-smoke-${Date.now()}-2`,
        convId: conversation.id,
        role: 'assistant',
        status: 'success',
        createdAt: Date.now(),
        modelInfo: { provider: 'mock', model: 'mock-model' },
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'execute_command', args: { command: 'pnpm check' } }],
      } as never,
    })

    // 前端搜索 RPC（LIKE over JSON）保持原语义可用
    const frontendSearch = await runtime.invoke('search.searchByKeyword', { query: 'smoke-token' })
    expect(frontendSearch.length).toBeGreaterThan(0)
    expect(frontendSearch[0].messages[0].id).toBe(first.id)

    // 消息列表按 created_at ASC, rowid ASC（ordinal 不影响既有查询）
    const messages = await runtime.invoke('chat.getMessagesByConvId', { convId: conversation.id })
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant'])
  })

  it('记忆目录 RPC：approve 校验、归档、正文读取', async () => {
    await expect(runtime.invoke('memoryCatalog.approve', { memoryId: 'mem-missing' }))
      .rejects
      .toThrow('记忆未找到')
    await expect(runtime.invoke('memoryCatalog.getBody', { memoryId: 'mem-missing' }))
      .rejects
      .toThrow('记忆未找到')

    const empty = await runtime.invoke('memoryCatalog.list', undefined)
    expect(empty).toEqual([])
    const pending = await runtime.invoke('memoryCatalog.list', { status: 'pending' })
    expect(pending).toEqual([])
  })
})
