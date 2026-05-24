import type { AgentRuntimeConfig, AgentRuntimeStartTaskOptions, AgentTurnResult, StartAgentTurnOptions } from '@ant-chat/shared'
import { AgentRuntime } from '@ant-chat/runtime'
import { createDbAIProvider } from '@main/agent/adapters/aiProviderFactory.adapter'
import { createCompactionStrategy } from '@main/agent/adapters/compactionStrategy.adapter'
import { dbModelResolver } from '@main/agent/adapters/dbModelResolver.adapter'
import { createElectronEventEmitter } from '@main/agent/adapters/electronEventEmitter.adapter'
import { electronLogger } from '@main/agent/adapters/electronLogger.adapter'
import { createElectronSessionStore } from '@main/agent/adapters/electronSessionStore.adapter'
import { electronToolProvider } from '@main/agent/adapters/toolProvider.adapter'
import { WorkspaceStore } from '@main/store/workspace'
import { LogPathManager } from '@main/utils/logPathManager'
import { TaskLogWriter } from '@main/utils/taskLogWriter'

function createRuntimeConfig(): AgentRuntimeConfig {
  const logPathManager = LogPathManager.getInstance()

  return {
    sessionStore: createElectronSessionStore(),
    modelResolver: dbModelResolver,
    aiProviderFactory: createDbAIProvider,
    toolProvider: electronToolProvider,
    compactionStrategy: createCompactionStrategy(),
    eventEmitter: createElectronEventEmitter(),
    logger: electronLogger,
    createTaskLogger: (conversationId: string, userMessageId: string) => {
      const filePath = logPathManager.getTaskLogPath(conversationId, userMessageId)
      return new TaskLogWriter(filePath)
    },
  }
}

let _agentRuntime: AgentRuntime | null = null

function getAgentRuntime(): AgentRuntime {
  if (!_agentRuntime) {
    _agentRuntime = new AgentRuntime(createRuntimeConfig())
  }
  return _agentRuntime
}

export const agentRuntime = new Proxy({} as AgentRuntime, {
  get(_, prop) {
    return (getAgentRuntime() as any)[prop]
  },
})

export async function startAgentTurn(options: StartAgentTurnOptions): Promise<AgentTurnResult> {
  const workspacePath = options.workspacePath
    ?? WorkspaceStore.getInstance().getCurrentWorkspacePath()
    ?? process.cwd()

  const startOptions: AgentRuntimeStartTaskOptions = {
    prompt: options.prompt,
    modelId: options.chatSettings.modelId,
    workspacePath,
    mode: options.mode ?? 'hybrid',
    chatSettings: {
      systemPrompt: options.chatSettings.systemPrompt,
      temperature: options.chatSettings.temperature,
      maxTokens: options.chatSettings.maxTokens,
    },
  }
  if (options.conversationId)
    startOptions.conversationId = options.conversationId
  if (options.images)
    startOptions.images = options.images
  if (options.attachments)
    startOptions.attachments = options.attachments
  if (options.referencedFiles)
    startOptions.referencedFiles = options.referencedFiles
  if (options.selectedSkill)
    startOptions.selectedSkill = options.selectedSkill

  return await agentRuntime.startTask(startOptions)
}
