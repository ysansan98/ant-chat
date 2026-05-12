import type { AddMessage, AgentRuntimeConfig, AgentTurnResult, StartAgentTurnOptions } from '@ant-chat/shared'
import { AgentRuntime, buildPromptWithTurnContext } from '@ant-chat/agent-runtime'
import { createDbAIProvider } from '@main/agent/adapters/aiProviderFactory.adapter'
import { dbModelResolver } from '@main/agent/adapters/dbModelResolver.adapter'
import { electronEventEmitter } from '@main/agent/adapters/electronEventEmitter.adapter'
import { electronLogger } from '@main/agent/adapters/electronLogger.adapter'
import { electronPathProvider } from '@main/agent/adapters/electronPathProvider.adapter'
import { createDbMessageStore } from '@main/agent/adapters/messageStore.adapter'
import { electronToolProvider } from '@main/agent/adapters/toolProvider.adapter'
import { addConversation, addMessage, getConversationById } from '@main/db/services'
import { WorkspaceStore } from '@main/store/workspace'
import { isDev } from '@main/utils/env'

function createRuntimeConfig(): AgentRuntimeConfig {
  return {
    messageStore: createDbMessageStore(),
    aiProviderFactory: createDbAIProvider,
    eventEmitter: electronEventEmitter,
    pathProvider: electronPathProvider,
    modelResolver: dbModelResolver,
    toolProvider: electronToolProvider,
    logger: electronLogger,
    isDev,
  }
}

export const agentRuntime = new AgentRuntime(createRuntimeConfig())

const DEFAULT_CONVERSATION_TITLE = 'Untitled'

export async function startAgentTurn(options: StartAgentTurnOptions): Promise<AgentTurnResult> {
  const prompt = options.prompt.trim()
  if (!prompt) {
    throw new Error('invalid start turn options: missing prompt')
  }
  if (!options.chatSettings?.modelId?.trim()) {
    throw new Error('invalid start turn options: missing modelId')
  }

  const workspacePath = options.workspacePath
    ?? WorkspaceStore.getInstance().getCurrentWorkspacePath()
    ?? process.cwd()

  const conversation = options.conversationId
    ? await getConversationById(options.conversationId)
    : await addConversation({
        title: DEFAULT_CONVERSATION_TITLE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workspacePath,
        settings: {
          modelId: options.chatSettings.modelId,
          systemPrompt: options.chatSettings.systemPrompt,
          temperature: options.chatSettings.temperature,
          maxTokens: options.chatSettings.maxTokens,
        },
      })

  const activeTasks = agentRuntime.listActiveTasks(conversation.id)
  if (activeTasks.length > 0) {
    throw new Error('AGENT_TASK_ALREADY_RUNNING')
  }

  const userMessage = await addMessage({
    convId: conversation.id,
    role: 'user',
    status: 'success',
    content: [{ type: 'text', text: prompt }],
    images: options.images ?? [],
    attachments: options.attachments ?? [],
  } satisfies AddMessage)

  const task = await agentRuntime.startTask({
    conversationId: conversation.id,
    userMessageId: userMessage.id,
    prompt: buildPromptWithTurnContext({
      prompt,
      referencedFiles: options.referencedFiles,
      selectedSkill: options.selectedSkill,
    }),
    referencedFiles: options.referencedFiles,
    selectedSkill: options.selectedSkill,
    executionMode: options.mode,
    workspacePath,
    modelConfig: options.chatSettings,
    compaction: conversation.settings?.compaction,
  })

  return {
    ...task,
    conversationId: conversation.id,
    userMessageId: userMessage.id,
    conversation,
  }
}
