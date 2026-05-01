import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useAimock as setupAimock } from '@copilotkit/aimock/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentRuntime } from '../../src/main/agent/runtime/agentRuntime'
import { taskStore } from '../../src/main/agent/runtime/taskStore'
import { initializeTestDb } from '../../src/main/db/db'
import { createConversation, createProviderService, createProviderServiceModel } from '../../src/main/db/services/__tests__/factory'
import { getMessagesByConvId } from '../../src/main/db/services/message'

vi.mock('@main/window', () => ({
  getMainWindow: () => null,
}))

const aimock = setupAimock({ patchEnv: false })

describe('agent runtime aimock e2e', () => {
  let workspacePath: string

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    ;(taskStore as any).tasks?.clear?.()
    ;(taskStore as any).activeByConversation?.clear?.()
    await initializeTestDb()
    workspacePath = await mkdtemp(path.join(tmpdir(), 'ant-chat-agent-runtime-'))
    await writeFile(path.join(workspacePath, 'README.md'), '# Test Workspace\n\nAimock integration target.\n', 'utf8')

    aimock().llm.reset()
    aimock().llm.on({
      predicate: request => getLastUserText(request).includes('工具 list_dir 执行成功'),
    }, {
      content: 'Done. README.md exists in the workspace.',
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
        total_tokens: 20,
      },
    })
    aimock().llm.on({
      predicate: (request) => {
        const lastUserText = getLastUserText(request)
        return lastUserText.includes('lastAction=other') && !lastUserText.includes('工具 list_dir 执行成功')
      },
    }, {
      toolCalls: [
        {
          name: 'list_dir',
          arguments: { path: '.', limit: 20 },
        },
      ],
    })
  })

  afterEach(async () => {
    for (const task of (taskStore as any).tasks?.values?.() || []) {
      task.abortController?.abort?.()
    }
    ;(taskStore as any).tasks?.clear?.()
    ;(taskStore as any).activeByConversation?.clear?.()
    vi.restoreAllMocks()
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('runs model and native tool loop through an OpenAI-compatible aimock server', async () => {
    const provider = await createProviderService({
      id: 'aimock-provider',
      name: 'aimock',
      baseUrl: `${aimock().url}/v1`,
      apiKey: 'mock',
      apiMode: 'openai',
      isEnabled: true,
    })
    const model = await createProviderServiceModel({
      id: 'aimock-model',
      name: 'Aimock Test Model',
      model: 'gpt-4o-mini',
      serviceProviderId: provider.id,
    })
    const conversation = await createConversation({
      id: 'conv-aimock-runtime',
      workspacePath,
    })

    const result = await agentRuntime.startTask({
      conversationId: conversation.id,
      userMessageId: 'user-message-1',
      prompt: 'inspect workspace',
      workspacePath,
      mode: 'hybrid',
      chatSettings: {
        modelId: model.id,
        systemPrompt: '',
        temperature: 0,
        maxTokens: 256,
        features: {
          enableMCP: false,
          onlineSearch: false,
        },
      },
    })

    await waitForTaskToFinish(result.taskId)

    const messages = await getMessagesByConvId(conversation.id)
    const assistantMessages = messages.filter(message => message.role === 'assistant')
    expect(assistantMessages).toHaveLength(2)

    expect(assistantMessages[0]).toEqual(expect.objectContaining({
      status: 'success',
      toolCalls: [
        expect.objectContaining({
          toolName: 'list_dir',
          executeState: 'completed',
          result: expect.objectContaining({
            success: true,
          }),
        }),
      ],
    }))
    expect(assistantMessages[1]).toEqual(expect.objectContaining({
      status: 'success',
    }))
    expect(assistantMessages[1].content).toEqual([
      { type: 'text', text: 'Done. README.md exists in the workspace.' },
    ])
  })
})

function getLastUserText(request: any): string {
  const message = request.messages?.filter((item: any) => item.role === 'user').at(-1)
  if (!message) {
    return ''
  }
  if (typeof message.content === 'string') {
    return message.content
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((item: any) => typeof item.text === 'string' ? item.text : '')
      .join('\n')
  }
  return ''
}

async function waitForTaskToFinish(taskId: string) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 3000) {
    try {
      const task = agentRuntime.getTask(taskId)
      if (['success', 'failed', 'cancelled'].includes(task.status)) {
        expect(task.status).toBe('success')
        return
      }
    }
    catch (error) {
      if ((error as Error).message === 'AGENT_TASK_NOT_FOUND') {
        return
      }
      throw error
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const requests = aimock().llm.getRequests()
  throw new Error(JSON.stringify({
    status: agentRuntime.getTask(taskId).status,
    requestCount: requests.length,
    lastRequests: requests.slice(-3).map((entry: any) => ({
      entryKeys: Object.keys(entry),
      responseStatus: entry.response?.status,
      bodyKeys: Object.keys(entry.body || {}),
      lastUser: getLastUserText(entry.body || {}),
      responseBody: entry.response?.body,
      matched: entry.fixtureIndex ?? entry.fixture ?? entry.source ?? null,
    })),
  }, null, 2))
}
