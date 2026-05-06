import type { AddMessage, AgentTurnResult, StartAgentTurnOptions } from '@ant-chat/shared'
import { addConversation, addMessage, getConversationById } from '@main/db/services'
import { WorkspaceStore } from '@main/store/workspace'
import { agentRuntime } from './agentRuntime'

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
    prompt,
    mode: options.mode,
    workspacePath,
    chatSettings: options.chatSettings,
    compaction: conversation.settings?.compaction,
  })

  return {
    ...task,
    conversationId: conversation.id,
    userMessageId: userMessage.id,
    conversation,
  }
}
