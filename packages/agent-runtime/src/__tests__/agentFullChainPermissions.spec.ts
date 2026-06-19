import type { AgentMode, IAgentEventEmitter, IAIProvider, IAIStreamChunk, LoopMessage, ToolResultContent } from '@ant-chat/shared'
import { createAgentRuntime } from '@ant-chat/agent-core'
import { createAppDataContext } from '@ant-chat/app-data'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRuntimeController } from '../agentRuntimeController'
import { createAppDataSessionStore } from '../sessionStore'

const TEST_MODEL_ID = 'mock-model'

describe('agent 真实链路权限行为', () => {
  let harness: AgentRuntimeHarness

  beforeEach(() => {
    harness = createHarness()
  })

  afterEach(async () => {
    await harness.dispose()
  })

  it('hybrid 模式支持读取工作区绝对路径文件且不触发审批', async () => {
    const filePath = harness.workspaceFile('src/readme.md')
    writeFileSync(filePath, 'workspace read content\n', 'utf8')
    harness.provider.enqueueToolCall('read_file', { path: filePath })
    harness.provider.enqueueText('读取完成')

    const result = await harness.startTurn('读取工作区文件', 'hybrid')
    await harness.waitForFinish(result.conversationId)

    expect(harness.approvals).toEqual([])
    expect(harness.provider.requests).toHaveLength(2)
    expect(extractToolResults(harness.provider.requests[1]!.messages)).toEqual([
      expect.objectContaining({
        toolName: 'read_file',
        isError: false,
        result: expect.stringContaining('workspace read content'),
      }),
    ])
    expect(await harness.listToolMessages(result.conversationId)).toEqual([
      expect.objectContaining({
        role: 'tool',
        status: 'success',
        content: [
          expect.objectContaining({
            toolName: 'read_file',
            isError: false,
            result: expect.stringContaining('workspace read content'),
          }),
        ],
      }),
    ])
  })

  it('hybrid 模式支持写入工作区绝对路径文件且不触发审批', async () => {
    const filePath = harness.workspaceFile('src/generated.ts')
    harness.provider.enqueueToolCall('write_file', {
      path: filePath,
      content: 'export const value = 42\n',
    })
    harness.provider.enqueueText('写入完成')

    const result = await harness.startTurn('写入工作区文件', 'hybrid')
    await harness.waitForFinish(result.conversationId)

    expect(harness.approvals).toEqual([])
    expect(readFileSync(filePath, 'utf8')).toBe('export const value = 42\n')
    expect(await harness.listToolMessages(result.conversationId)).toEqual([
      expect.objectContaining({
        role: 'tool',
        status: 'success',
        content: [
          expect.objectContaining({
            toolName: 'write_file',
            isError: false,
            result: expect.stringContaining('generated.ts'),
          }),
        ],
      }),
    ])
  })

  it('hybrid 模式支持编辑工作区绝对路径文件且不触发审批', async () => {
    const filePath = harness.workspaceFile('src/edit.ts')
    writeFileSync(filePath, 'export const name = "before"\n', 'utf8')
    harness.provider.enqueueToolCall('edit_file', {
      path: filePath,
      edits: [{ oldText: '"before"', newText: '"after"' }],
    })
    harness.provider.enqueueText('编辑完成')

    const result = await harness.startTurn('编辑工作区文件', 'hybrid')
    await harness.waitForFinish(result.conversationId)

    expect(harness.approvals).toEqual([])
    expect(readFileSync(filePath, 'utf8')).toBe('export const name = "after"\n')
    expect(await harness.listToolMessages(result.conversationId)).toEqual([
      expect.objectContaining({
        role: 'tool',
        status: 'success',
        content: [
          expect.objectContaining({
            toolName: 'edit_file',
            isError: false,
            result: expect.stringContaining('replacements=1'),
          }),
        ],
      }),
    ])
  })

  it('hybrid 模式支持目录和搜索工具使用工作区绝对路径且不触发审批', async () => {
    const dirPath = harness.workspaceFile('src')
    writeFileSync(path.join(dirPath, 'alpha.ts'), 'export const marker = "needle"\n', 'utf8')
    writeFileSync(path.join(dirPath, 'beta.md'), 'notes\n', 'utf8')
    harness.provider.enqueueToolCall('list_dir', { path: dirPath })
    harness.provider.enqueueToolCall('glob_files', { path: dirPath, pattern: '*.ts' })
    harness.provider.enqueueToolCall('grep_files', { path: dirPath, pattern: 'needle', include: '*.ts' })
    harness.provider.enqueueText('搜索完成')

    const result = await harness.startTurn('检查工作区目录', 'hybrid')
    await harness.waitForFinish(result.conversationId)

    expect(harness.approvals).toEqual([])
    const messages = await harness.listToolMessages(result.conversationId)
    expect(messages.map(message => message.content[0]?.toolName)).toEqual([
      'list_dir',
      'glob_files',
      'grep_files',
    ])
    expect(messages).toEqual([
      expect.objectContaining({ status: 'success', content: [expect.objectContaining({ result: expect.stringContaining('alpha.ts') })] }),
      expect.objectContaining({ status: 'success', content: [expect.objectContaining({ result: expect.stringContaining('alpha.ts') })] }),
      expect.objectContaining({ status: 'success', content: [expect.objectContaining({ result: expect.stringContaining('needle') })] }),
    ])
  })

  it('strict 模式下工作区绝对路径写入需要审批，审批通过后继续执行', async () => {
    const filePath = harness.workspaceFile('src/approved.ts')
    harness.provider.enqueueToolCall('write_file', {
      path: filePath,
      content: 'export const approved = true\n',
    })
    harness.provider.enqueueText('审批后写入完成')

    const result = await harness.startTurn('严格模式写入文件', 'strict')
    const approval = await harness.waitForApproval()
    expect(approval).toEqual(expect.objectContaining({
      taskId: result.taskId,
      conversationId: result.conversationId,
      pendingAction: expect.objectContaining({
        toolName: 'write_file',
        operationType: 'write',
        scope: 'workspace',
      }),
    }))

    harness.controller.approvePendingAction({
      taskId: approval.taskId,
      actionId: approval.pendingAction.actionId,
    })
    await harness.waitForFinish(result.conversationId)

    expect(readFileSync(filePath, 'utf8')).toBe('export const approved = true\n')
    expect(await harness.listToolMessages(result.conversationId)).toEqual([
      expect.objectContaining({
        role: 'tool',
        status: 'success',
        content: [
          expect.objectContaining({
            toolName: 'write_file',
            isError: false,
            result: expect.stringContaining('approved.ts'),
          }),
        ],
      }),
    ])
  })
})

interface BetterSqliteDatabase { close: () => void }
type BetterSqliteConstructor = new (filename: string) => BetterSqliteDatabase
type StartTurnResult = Awaited<ReturnType<ReturnType<typeof createAgentRuntimeController>['startTurn']>>

interface CapturedApproval {
  taskId: string
  conversationId: string
  pendingAction: Parameters<IAgentEventEmitter['emitApprovalRequired']>[2]
}

interface AgentRuntimeHarness {
  workspacePath: string
  approvals: CapturedApproval[]
  controller: ReturnType<typeof createAgentRuntimeController>
  provider: ScriptedProvider
  startTurn: (prompt: string, mode: AgentMode) => Promise<StartTurnResult>
  waitForApproval: () => Promise<CapturedApproval>
  waitForFinish: (conversationId: string) => Promise<void>
  workspaceFile: (relativePath: string) => string
  listToolMessages: (conversationId: string) => Promise<Array<{ role: string, status: string, content: ToolResultContent[] }>>
  dispose: () => Promise<void>
}

class ScriptedProvider implements IAIProvider {
  readonly requests: Array<{ messages: LoopMessage[] }> = []
  private chunks: IAIStreamChunk[] = []
  private nextToolCallId = 1

  enqueueToolCall(toolName: string, args: Record<string, unknown>) {
    this.chunks.push({
      functionCalls: [{
        id: `call-${this.nextToolCallId++}`,
        toolName,
        args,
      }],
    })
  }

  enqueueText(text: string) {
    this.chunks.push({
      content: [{ type: 'text', text }],
      finishReason: 'stop',
    })
  }

  async* streamModel(options: Parameters<IAIProvider['streamModel']>[0]) {
    this.requests.push({ messages: options.messages })
    const chunk = this.chunks.shift()
    if (!chunk) {
      throw new Error('测试 LLM 脚本已耗尽')
    }
    yield chunk
  }

  async complete() {
    return { text: 'summary' }
  }
}

function createHarness(): AgentRuntimeHarness {
  const rootPath = mkdtempSync(path.join(tmpdir(), 'ant-chat-agent-runtime-'))
  const workspacePath = path.join(rootPath, 'workspace')
  mkdirSync(path.join(workspacePath, 'src'), { recursive: true })

  const BetterSqlite = loadBetterSqlite()
  const db = new BetterSqlite(':memory:')
  const appDataContext = createAppDataContext({
    db: db as never,
    settingsFilePath: path.join(rootPath, 'settings.json'),
    mcpSettingsFilePath: path.join(rootPath, 'mcp-settings.json'),
    memoryRootPath: path.join(rootPath, 'memory'),
    workspaceSettingsFilePath: path.join(rootPath, 'workspaces.json'),
    attachmentsRootPath: path.join(rootPath, 'attachments'),
  })
  appDataContext.providerSettingsRepository.createProvider({
    id: 'mock-provider',
    name: 'Mock Provider',
    baseUrl: 'https://llm.example.com',
    apiKey: 'test-key',
    apiMode: 'openai',
    isOfficial: false,
    isEnabled: true,
  })
  appDataContext.providerSettingsRepository.createProviderModel({
    providerId: 'mock-provider',
    model: TEST_MODEL_ID,
    name: 'Mock Model',
    maxTokens: 4096,
    contextLength: 128000,
    temperature: 0,
    capabilities: { functionCall: true },
  })

  const provider = new ScriptedProvider()
  const approvals: CapturedApproval[] = []
  const eventEmitter: IAgentEventEmitter = {
    async emitTaskUpdated() {},
    async emitApprovalRequired(taskId, conversationId, pendingAction) {
      approvals.push({ taskId, conversationId, pendingAction })
    },
    async emitTurnStarted() {},
    async emitTurnChunk() {},
    async emitTurnToolCalls() {},
    async emitTurnToolResults() {},
    async emitTurnFinished() {},
  }
  const runtime = createAgentRuntime({
    host: {
      eventEmitter,
      sessionStore: createAppDataSessionStore(appDataContext),
      modelCatalog: appDataContext.modelCatalog,
      memoryReader: appDataContext.memoryManager,
      loadFileData: appDataContext.loadAttachmentData,
      getToolApprovalWhitelistEntries: () => appDataContext.toolApprovalWhitelistRepository.getAll(),
    },
    overrides: {
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      aiProviderFactory: async () => provider,
    },
  })
  const controller = createAgentRuntimeController(runtime, appDataContext)

  return {
    workspacePath,
    approvals,
    controller,
    provider,
    async startTurn(prompt, mode) {
      return await controller.startTurn({
        prompt,
        workspacePath,
        mode,
        modelConfig: {
          modelId: TEST_MODEL_ID,
          systemPrompt: '',
          temperature: 0,
          maxTokens: 4096,
          features: { enableMCP: false },
        },
      })
    },
    async waitForApproval() {
      return await waitFor(() => approvals[0], '等待审批事件超时')
    },
    async waitForFinish(conversationId) {
      await waitFor(() => controller.listActiveTasks(conversationId).length === 0, '等待 agent 任务结束超时')
    },
    workspaceFile(relativePath) {
      return path.join(workspacePath, relativePath)
    },
    async listToolMessages(conversationId) {
      const messages = await runtime.getMessages(conversationId)
      return messages
        .filter(message => message.role === 'tool')
        .map(message => ({
          role: message.role,
          status: message.status,
          content: message.content as ToolResultContent[],
        }))
    },
    async dispose() {
      await runtime.dispose()
      db.close()
      rmSync(rootPath, { recursive: true, force: true })
    },
  }
}

function extractToolResults(messages: LoopMessage[]): ToolResultContent[] {
  return messages
    .flatMap(message => message.content)
    .filter((content): content is ToolResultContent => content.type === 'tool-result')
}

async function waitFor<T>(getValue: () => T | undefined | false, errorMessage: string): Promise<T> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 3000) {
    const value = getValue()
    if (value) {
      return value
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(errorMessage)
}

function loadBetterSqlite(): BetterSqliteConstructor {
  const require = createRequire(import.meta.url)
  return require('better-sqlite3') as BetterSqliteConstructor
}
