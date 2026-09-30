import type { IAgentEventEmitter, IAIProvider, IAIStreamChunk, IConversations, IMessage } from '@ant-chat/shared'
import { createAgentRuntime } from '../../agent-core'
import { createConversationLifecycle } from '../../conversations/conversationLifecycle'
import { createAppDataContext } from '../../data'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentTurnService } from '../agentTurnService'
import { createPendingMessageService } from '../pendingMessageService'
import { createAppDataSessionStore } from '../sessionStore'

const TEST_MODEL_ID = 'mock-model'

interface BetterSqliteDatabase { close: () => void }
type BetterSqliteConstructor = new (filename: string) => BetterSqliteDatabase

class ControllableProvider implements IAIProvider {
  requestCount = 0
  private readonly chunks: IAIStreamChunk[] = []
  private readonly waiters: Array<(chunk: IAIStreamChunk) => void> = []

  /** 推入一个模型输出 chunk；有等待中的流立即消费，否则缓存。 */
  push(chunk: IAIStreamChunk) {
    const waiter = this.waiters.shift()
    if (waiter)
      waiter(chunk)
    else
      this.chunks.push(chunk)
  }

  async* streamModel() {
    this.requestCount += 1
    while (true) {
      const chunk = this.chunks.shift() ?? await new Promise<IAIStreamChunk>(resolve => this.waiters.push(resolve))
      yield chunk
      if (chunk.finishReason)
        return
    }
  }

  async complete() {
    return { text: 'summary' }
  }
}

function createEventEmitter(): IAgentEventEmitter {
  return {
    async emitTaskUpdated() {},
    async emitApprovalRequired() {},
    async emitTurnStarted() {},
    async emitTurnChunk() {},
    async emitTurnToolCalls() {},
    async emitTurnToolResults() {},
    async emitTurnFinished() {},
  }
}

async function waitFor<T>(getValue: () => T | undefined | false, errorMessage: string): Promise<T> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5000) {
    const value = getValue()
    if (value)
      return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(errorMessage)
}

async function waitForAsync(getValue: () => Promise<boolean>, errorMessage: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5000) {
    if (await getValue())
      return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(errorMessage)
}

describe('待处理队列接力真实链路', () => {
  let rootPath: string
  let workspacePath: string
  let db: BetterSqliteDatabase
  let provider: ControllableProvider
  let appDataContext: ReturnType<typeof createAppDataContext>
  let runtime: ReturnType<typeof createAgentRuntime>
  let pendingMessages: ReturnType<typeof createPendingMessageService>
  let turnService: ReturnType<typeof createAgentTurnService>
  let conversation: IConversations

  beforeEach(async () => {
    rootPath = mkdtempSync(path.join(tmpdir(), 'ant-chat-pending-relay-'))
    workspacePath = path.join(rootPath, 'workspace')
    mkdirSync(workspacePath, { recursive: true })

    const BetterSqlite = loadBetterSqlite()
    db = new BetterSqlite(':memory:')
    appDataContext = createAppDataContext({
      db: db as never,
      settingsFilePath: path.join(rootPath, 'settings.json'),
      mcpSettingsFilePath: path.join(rootPath, 'mcp-settings.json'),
      memoryRootPath: path.join(rootPath, 'memory'),
      memoriesRootPath: path.join(rootPath, 'memories'),
      workspaceSettingsFilePath: path.join(rootPath, 'workspaces.json'),
      attachmentsRootPath: path.join(rootPath, 'attachments'),
      permissionsFilePath: path.join(rootPath, 'permissions.json'),
    })
    await appDataContext.providerSettingsRepository.createProvider({
      id: 'mock-provider',
      name: 'Mock Provider',
      baseUrl: 'https://llm.example.com',
      apiMode: 'openai',
      integrationId: 'api-key',
      isOfficial: false,
      isEnabled: true,
    })
    await appDataContext.providerSettingsRepository.createProviderModel({
      providerId: 'mock-provider',
      model: TEST_MODEL_ID,
      name: 'Mock Model',
      maxOutputTokens: 4096,
      contextLength: 128000,
      temperature: 0,
      capabilities: { functionCall: true },
    })

    provider = new ControllableProvider()
    // 延迟绑定：任务终态回调在 turnService 就绪后接管接力
    let relayPending: ((conversationId: string) => Promise<void>) | undefined
    runtime = createAgentRuntime({
      host: {
        eventEmitter: createEventEmitter(),
        sessionStore: createAppDataSessionStore(appDataContext),
        memoryReader: appDataContext.memoryManager,
        loadFileData: appDataContext.loadAttachmentData,
        getPermissionRules: workspace => appDataContext.permissionsFileStore.getEffectiveRules(workspace),
        savePermissionRules: (scope, workspace, rules) => appDataContext.permissionsFileStore.saveRules(scope, workspace, rules),
        onTaskSettled: (event) => {
          if (event.status === 'cancelled')
            return
          void relayPending?.(event.conversationId)
        },
      },
      overrides: {
        logger: { info() {}, warn() {}, error() {} },
      },
    })
    const conversationLifecycle = createConversationLifecycle({
      data: appDataContext,
      events: { emit() {} },
      runtime,
    })
    pendingMessages = createPendingMessageService({
      repository: appDataContext.pendingMessageRepository,
      injectSteering: (conversationId, text) => runtime.injectSteering(conversationId, text),
      emitUpdated: () => {},
    })
    turnService = createAgentTurnService({
      runtime,
      appDataContext,
      conversationLifecycle,
      pendingMessages,
      aiProviderFactory: async () => provider,
    })
    relayPending = conversationId => turnService.relayPendingMessages(conversationId)

    conversation = await conversationLifecycle.create({
      title: 'Untitled',
      workspacePath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      conversationInstructions: '',
      settings: { modelId: TEST_MODEL_ID, providerId: 'mock-provider' },
    })
  })

  afterEach(async () => {
    await runtime.dispose()
    db.close()
    rmSync(rootPath, { recursive: true, force: true })
  })

  it('运行中提交入队，任务终态后自动以新一轮发出，逐条接力', async () => {
    const modelConfig = { modelId: TEST_MODEL_ID, providerId: 'mock-provider' }

    // 1) 第一轮直接启动
    const first = await turnService.startTurn({
      conversationId: conversation.id,
      messageContent: [{ type: 'text', text: '第一轮' }],
      workspacePath,
      mode: 'hybrid',
      modelConfig,
    })
    expect(first.kind).toBe('started')
    await waitFor(() => provider.requestCount === 1 && runtime.listActiveTasks(conversation.id).length === 1, '等待第一轮任务进入模型调用')

    // 2) 运行中提交第二条 → 入队，不打断当前任务
    const second = await turnService.startTurn({
      conversationId: conversation.id,
      messageContent: [{ type: 'text', text: '第二轮' }],
      workspacePath,
      mode: 'hybrid',
      modelConfig,
    })
    expect(second.kind).toBe('queued')
    expect((await pendingMessages.snapshot(conversation.id)).messages.map(message => message.text)).toEqual(['第二轮'])
    expect(provider.requestCount).toBe(1)

    // 3) 放行第一轮 → 任务终态触发接力，第二轮自动启动
    provider.push({ content: [{ type: 'text', text: '第一轮回复' }], finishReason: 'stop' })
    await waitFor(() => provider.requestCount === 2, '等待接力启动第二轮任务')

    // 接力发出后队列已清空
    await waitForAsync(async () => (await pendingMessages.snapshot(conversation.id)).messages.length === 0, '等待接力出队')

    // 4) 放行第二轮 → 全部结束
    provider.push({ content: [{ type: 'text', text: '第二轮回复' }], finishReason: 'stop' })
    await waitFor(() => runtime.listActiveTasks(conversation.id).length === 0, '等待第二轮任务结束')

    const messages = await appDataContext.messageRepository.listByConversation(conversation.id)
    const userTexts = messages
      .filter(message => message.role === 'user')
      .map(message => extractFirstText(message))
    expect(userTexts).toEqual(['第一轮', '第二轮'])
  })

  it('取消的任务不触发接力，队列保留等待用户处理', async () => {
    const modelConfig = { modelId: TEST_MODEL_ID, providerId: 'mock-provider' }
    const first = await turnService.startTurn({
      conversationId: conversation.id,
      messageContent: [{ type: 'text', text: '第一轮' }],
      workspacePath,
      mode: 'hybrid',
      modelConfig,
    })
    expect(first.kind).toBe('started')
    await waitFor(() => provider.requestCount === 1, '等待第一轮任务进入模型调用')

    await turnService.startTurn({
      conversationId: conversation.id,
      messageContent: [{ type: 'text', text: '保留消息' }],
      workspacePath,
      mode: 'hybrid',
      modelConfig,
    })

    const activeTask = runtime.listActiveTasks(conversation.id)[0]
    runtime.cancelTask({ taskId: activeTask.taskId })
    await waitFor(() => runtime.listActiveTasks(conversation.id).length === 0, '等待取消生效')
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(provider.requestCount).toBe(1)
    expect((await pendingMessages.snapshot(conversation.id)).messages.map(message => message.text)).toEqual(['保留消息'])
  })
})

function extractFirstText(message: IMessage): string {
  const block = message.content.find(item => item.type === 'text')
  return block?.type === 'text' ? block.text : ''
}

function loadBetterSqlite(): BetterSqliteConstructor {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as BetterSqliteConstructor
}
