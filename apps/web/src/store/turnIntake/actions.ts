import type {
  AgentMode,
  ConversationsId,
  ConversationsSettingsSchema,
  IConversations,
  IMessageContent,
  StartAgentTurnOptions,
} from '@ant-chat/shared'
import agentApi from '@/api/agentApi'
import chatApi from '@/api/chatApi'
import commandsApi from '@/api/commandsApi'
import {
  hasSkillReference,
  hasWorkspacePathReference,
  parseBuiltinCommand,
} from '@/components/Sender/builtinCommandParser'
import { isTaskActive } from '@/store/agentRuntime'
import { upsertConversationAction } from '@/store/conversation'
import { addPendingSteeringMessage } from '@/store/messages'
import { enqueuePendingMessage, enqueueVisualizationNextTurn } from '@/store/pendingMessages/queue'
import { activateConversationSession, commitConversationSelection } from '@/store/workspaceSession'

export type TurnOrigin = 'chat' | 'visualization' | 'pending'
export type TurnKind = 'regular' | 'command' | 'steering' | 'next-turn'

export interface SubmitTurnIntakeOptions {
  origin: TurnOrigin
  conversationId?: string
  messageContent: IMessageContent
  mode: AgentMode
  workspacePath: string
  settings: ConversationsSettingsSchema
  conversationInstructions?: string
  knownSkillNames?: ReadonlySet<string>
  /** pending queue 的既定投递语义；其他入口由 intake 自行分类。 */
  delivery?: 'steering' | 'next-turn'
  onCommandRunningChange?: (running: boolean) => void
}

export interface SubmitTurnIntakeResult {
  kind: TurnKind
  conversationId?: string
  /** Turn 已提交，但前端未能立即完成持久化投影对账。 */
  projectionWarning?: string
}

/**
 * 统一接收 Chat、Visualization 与 pending queue 的轮次意图。
 *
 * 调用者只描述来源和内容；本模块拥有 command/steering/next-turn 分类、
 * 运行时启动，以及 conversation/messages/runtime 投影对账。
 */
export async function submitTurnIntake(options: SubmitTurnIntakeOptions): Promise<SubmitTurnIntakeResult> {
  const text = extractText(options.messageContent)
  const activeTask = options.conversationId
    ? (await agentApi.listActiveTasks(options.conversationId)).find(isTaskActive)
    : undefined

  if (activeTask)
    return submitWhileRunning(options, text)

  if (options.origin === 'chat') {
    const command = parseBuiltinCommand(text, options.knownSkillNames)
    if (command)
      return runCommand(options, command)
  }

  if (!options.settings.modelId)
    throw new Error('请选择模型')

  const result = await agentApi.startTurn(toStartTurnOptions(options))
  const projectionWarning = await reconcileCommittedConversation(result.conversationId, result.conversation)
  return { kind: 'regular', conversationId: result.conversationId, projectionWarning }
}

export async function cancelTurnCommand(conversationId: string): Promise<void> {
  if (!conversationId)
    return
  await commandsApi.cancelCommand(conversationId)
  const conversation = await chatApi.getConversationById(conversationId)
  await reconcileCommittedConversation(conversationId, conversation)
}

async function submitWhileRunning(
  options: SubmitTurnIntakeOptions,
  text: string,
): Promise<SubmitTurnIntakeResult> {
  const conversationId = options.conversationId
  if (!conversationId)
    throw new Error('运行中的任务缺少会话 ID')

  if (options.origin === 'visualization') {
    enqueueVisualizationNextTurn(conversationId, text)
    return { kind: 'next-turn', conversationId }
  }

  if (options.origin === 'pending') {
    if (options.delivery === 'next-turn')
      return { kind: 'next-turn', conversationId }
    const message = await agentApi.injectSteering(conversationId, text)
    addPendingSteeringMessage(message)
    return { kind: 'steering', conversationId }
  }

  const hasAttachment = options.messageContent.some(block => block.type !== 'text')
  if (
    hasAttachment
    || hasWorkspacePathReference(text)
    || hasSkillReference(text, options.knownSkillNames)
  ) {
    throw new Error('任务进行中，待处理消息暂不支持附件或引用')
  }

  enqueuePendingMessage(conversationId, text)
  return { kind: 'steering', conversationId }
}

async function runCommand(
  options: SubmitTurnIntakeOptions,
  command: NonNullable<ReturnType<typeof parseBuiltinCommand>>,
): Promise<SubmitTurnIntakeResult> {
  options.onCommandRunningChange?.(true)
  try {
    const result = await commandsApi.runBuiltinCommand({
      id: command.id,
      conversationId: options.conversationId || undefined,
      argument: command.argument,
      ...(command.id === 'new'
        ? { conversationInstructions: options.conversationInstructions }
        : {}),
      modelConfig: {
        modelId: options.settings.modelId,
        providerId: options.settings.providerId || '',
        temperature: options.settings.temperature ?? 0.7,
        maxOutputTokens: options.settings.maxOutputTokens ?? 4096,
        reasoningEffort: options.settings.reasoningEffort,
      },
      workspacePath: options.workspacePath,
    })
    let projectedConversationId = options.conversationId
    let projectionWarning: string | undefined

    if (result.status === 'success' && result.conversation) {
      projectionWarning = await reconcileCommittedConversation(result.conversation.id, result.conversation)
      projectedConversationId = result.conversation.id
    }

    if (command.id === 'compact' && options.conversationId) {
      try {
        const conversation = await chatApi.getConversationById(options.conversationId)
        projectionWarning = await reconcileCommittedConversation(options.conversationId, conversation)
      }
      catch {
        commitConversationSelection(options.conversationId as ConversationsId)
        projectionWarning = projectionFailureWarning()
      }
    }

    return { kind: 'command', conversationId: projectedConversationId, projectionWarning }
  }
  finally {
    options.onCommandRunningChange?.(false)
  }
}

async function reconcileCommittedConversation(
  conversationId: string,
  conversation?: IConversations,
): Promise<string | undefined> {
  if (conversation)
    upsertConversationAction(conversation)
  try {
    await activateConversationSession(conversationId)
    return undefined
  }
  catch {
    commitConversationSelection(conversationId as ConversationsId)
    return projectionFailureWarning()
  }
}

function projectionFailureWarning(): string {
  return '操作已完成，但会话状态同步失败，请稍后重新打开会话'
}

function toStartTurnOptions(options: SubmitTurnIntakeOptions): StartAgentTurnOptions {
  return {
    conversationId: options.conversationId || undefined,
    messageContent: options.messageContent,
    mode: options.mode,
    workspacePath: options.workspacePath,
    conversationInstructions: options.conversationInstructions,
    modelConfig: {
      modelId: options.settings.modelId,
      providerId: options.settings.providerId,
      temperature: options.settings.temperature,
      maxOutputTokens: options.settings.maxOutputTokens,
      reasoningEffort: options.settings.reasoningEffort,
    },
  }
}

function extractText(content: IMessageContent): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}
