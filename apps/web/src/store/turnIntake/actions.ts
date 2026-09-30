import type {
  AgentMode,
  AgentTurnQueuedResult,
  ConversationsId,
  ConversationsSettingsSchema,
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
import { useConversationsStore } from '@/store/conversation'
import { usePendingMessagesStore } from '@/store/pendingMessages/store'
import { activateConversationSession, commitConversationSelection } from '@/store/workspaceSession'

export type TurnOrigin = 'chat' | 'visualization'
export type TurnKind = 'regular' | 'command' | 'queued'

export interface SubmitTurnIntakeOptions {
  origin: TurnOrigin
  conversationId?: string
  messageContent: IMessageContent
  mode: AgentMode
  workspacePath: string
  settings: ConversationsSettingsSchema
  conversationInstructions?: string
  knownSkillNames?: ReadonlySet<string>
  onCommandRunningChange?: (running: boolean) => void
}

export interface SubmitTurnIntakeResult {
  kind: TurnKind
  conversationId?: string
  /** Turn 已提交，但前端未能立即完成持久化投影对账。 */
  projectionWarning?: string
}

/**
 * 统一接收 Chat 与 Visualization 的轮次意图。
 *
 * 调用者只描述来源和内容；本模块拥有「命令解析、提交、运行中排队（由后端判定）」，
 * 以及 conversation/messages/runtime 投影对账。运行中提交的排队与接力语义都在后端。
 */
export async function submitTurnIntake(options: SubmitTurnIntakeOptions): Promise<SubmitTurnIntakeResult> {
  const text = extractText(options.messageContent)
  const activeTask = options.conversationId
    ? (await agentApi.listActiveTasks(options.conversationId)).find(isTaskActive)
    : undefined

  if (activeTask) {
    // 任务运行中：附件与引用不支持排队，直接拒绝；纯文本交给后端入队。
    const hasAttachment = options.messageContent.some(block => block.type !== 'text')
    if (
      hasAttachment
      || hasWorkspacePathReference(text)
      || hasSkillReference(text, options.knownSkillNames)
    ) {
      throw new Error('任务进行中，待处理消息暂不支持附件或引用')
    }
  }
  else {
    if (options.origin === 'chat') {
      const command = parseBuiltinCommand(text, options.knownSkillNames)
      if (command)
        return runCommand(options, command)
    }
    // 排队不依赖模型；只有立即启动的轮次才要求已选择模型
    if (!options.settings.modelId)
      throw new Error('请选择模型')
  }

  const result = await agentApi.startTurn(toStartTurnOptions(options))
  if (result.kind === 'queued')
    return applyQueuedResult(result)

  const projectionWarning = await reconcileCommittedConversation(result.conversationId)
  return { kind: 'regular', conversationId: result.conversationId, projectionWarning }
}

export async function cancelTurnCommand(conversationId: string): Promise<void> {
  if (!conversationId)
    return
  await commandsApi.cancelCommand(conversationId)
  const conversation = await chatApi.getConversationById(conversationId)
  if (conversation) {
    reconcileCommittedConversation(conversationId)
  }
}

/** 运行中（或提交竞态下）入队：把后端返回的队列快照写入投影。 */
function applyQueuedResult(result: AgentTurnQueuedResult): SubmitTurnIntakeResult {
  usePendingMessagesStore.getState().applySnapshot(result.snapshot)
  return { kind: 'queued', conversationId: result.conversationId }
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
        reasoningEffort: options.settings.reasoningEffort,
      },
      workspacePath: options.workspacePath,
    })
    let projectedConversationId = options.conversationId
    let projectionWarning: string | undefined

    if (result.status === 'success' && result.conversationId) {
      projectionWarning = await reconcileCommittedConversation(result.conversationId)
      projectedConversationId = result.conversationId
    }

    if (command.id === 'compact' && options.conversationId) {
      try {
        const conversation = await chatApi.getConversationById(options.conversationId)
        if (conversation) {
          projectionWarning = await reconcileCommittedConversation(options.conversationId)
        }
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
): Promise<string | undefined> {
  try {
    await activateConversationSession(conversationId)
    reorderConversationToTopIfPresent(conversationId)
    return undefined
  }
  catch {
    commitConversationSelection(conversationId as ConversationsId)
    return projectionFailureWarning()
  }
}

function reorderConversationToTopIfPresent(conversationId: string): void {
  const state = useConversationsStore.getState()
  if (!state.conversations.some(c => c.id === conversationId)) {
    return
  }
  useConversationsStore.setState(prev => ({
    ...prev,
    conversations: [...prev.conversations].sort((left, right) => right.updatedAt - left.updatedAt),
  }))
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
