import type { AddMessage, IMessage, RunBuiltinCommandResult } from '@ant-chat/shared'
import type { AppDataContext } from '../../data'

export async function runFork(params: {
  appDataContext: AppDataContext
  sourceConversationId: string
  workspacePath: string
}): Promise<Extract<RunBuiltinCommandResult, { status: 'success' }>> {
  const { appDataContext, sourceConversationId, workspacePath } = params

  const sourceConversation = await appDataContext.conversationRepository.getById(sourceConversationId)
  if (!sourceConversation) {
    throw new Error(`Source conversation not found: ${sourceConversationId}`)
  }

  const sourceMessages = await appDataContext.messageRepository.listByConversation(sourceConversationId)

  // Create fork conversation with title "<source title> fork".
  const forkTitle = `${sourceConversation.title} fork`
  const forkConversation = await appDataContext.conversationRepository.create({
    workspacePath,
    title: forkTitle,
    conversationInstructions: sourceConversation.conversationInstructions ?? '',
    settings: { ...sourceConversation.settings },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  // Write fork origin event at the beginning
  await appDataContext.messageRepository.create({
    convId: forkConversation.id,
    role: 'event',
    status: 'success',
    content: [{
      type: 'text',
      text: `Forked from: ${sourceConversation.title} (${sourceConversation.id})`,
    }],
    eventType: 'fork',
  })

  // Copy messages in order, tracking old-to-new ID mapping for turnId references.
  const idMap = new Map<string, string>()
  // Stable mapping for tool-call/tool-result IDs so pairs stay linked
  const toolCallIdMap = new Map<string, string>()

  for (const msg of sourceMessages) {
    // Build the appropriate AddMessage shape per role, remapping IDs
    const addMsg = await messageToAddMessage(msg, forkConversation.id, idMap, toolCallIdMap, appDataContext)
    const created = await appDataContext.messageRepository.create(addMsg)
    idMap.set(msg.id, created.id)
  }

  return { status: 'success', conversation: forkConversation, conversationId: forkConversation.id }
}

/**
 * Convert a source message to an AddMessage shape for the fork conversation.
 * Remaps tool-call / tool-result IDs via a stable map so pairs stay linked,
 * and remaps turnId via the provided idMap (sourceId to forkId).
 */
async function messageToAddMessage(
  msg: IMessage,
  forkConvId: string,
  idMap: Map<string, string>,
  toolCallIdMap: Map<string, string>,
  appDataContext: AppDataContext,
): Promise<AddMessage> {
  const remappedContent = await Promise.all((msg.content as unknown as unknown[]).map(async (block) => {
    if (isVisualizationBlock(block)) {
      const data = await appDataContext.loadAttachmentData(block.source.file_id)
      if (!data) {
        throw new Error(`Visualization artifact not found: ${block.source.file_id}`)
      }
      return {
        ...block,
        source: { type: 'file_id' as const, file_id: `viz-${requireCryptoUUID()}` },
        data,
      }
    }
    const candidate = block as { type?: unknown, toolCallId?: unknown }
    if (candidate.type === 'tool-call' && typeof candidate.toolCallId === 'string') {
      return { ...(block as Record<string, unknown>), toolCallId: remapToolRef(candidate.toolCallId, toolCallIdMap) }
    }
    if (candidate.type === 'tool-result' && typeof candidate.toolCallId === 'string') {
      return { ...(block as Record<string, unknown>), toolCallId: remapToolRef(candidate.toolCallId, toolCallIdMap) }
    }
    return block
  }))

  const remappedTurnId = msg.turnId ? (idMap.get(msg.turnId) || msg.turnId) : undefined

  const base = {
    convId: forkConvId,
    content: remappedContent,
    turnId: remappedTurnId,
  }

  switch (msg.role) {
    case 'user':
      return {
        ...base,
        role: 'user' as const,
        status: 'success' as const,
      } as unknown as AddMessage

    case 'assistant':
      return {
        ...base,
        role: 'assistant' as const,
        status: (msg.status as 'success' | 'error' | 'loading' | 'typing' | 'cancel') || 'success',
        modelInfo: msg.modelInfo || { provider: '', model: '' },
        reasoningContent: msg.reasoningContent,
        usage: msg.usage,
        durationMs: msg.durationMs,
      } as unknown as AddMessage

    case 'tool':
      return {
        ...base,
        role: 'tool' as const,
        status: (msg.status === 'error' ? 'error' : 'success') as 'success' | 'error',
      } as unknown as AddMessage

    case 'event':
      if (msg.status !== 'success' && msg.status !== 'loading' && msg.status !== 'error') {
        throw new Error(`Invalid event message status: ${msg.status}`)
      }
      return {
        ...base,
        role: 'event' as const,
        status: msg.status,
        eventType: msg.eventType || 'unknown',
        modelInfo: msg.modelInfo,
        usage: msg.usage,
        compactedThroughMessageId: msg.compactedThroughMessageId
          ? idMap.get(msg.compactedThroughMessageId)
          : undefined,
      } as unknown as AddMessage

    default:
      throw new Error(`Unknown message role: ${(msg as IMessage).role}`)
  }
}

interface ForkVisualizationBlock {
  type: 'visualization'
  source: { type: 'file_id', file_id: string }
  format: 'ant-chat.visualization.v1'
  title: string
  summary: string
  size: number
  sha256: string
  data?: string
}

function isVisualizationBlock(value: unknown): value is ForkVisualizationBlock {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const block = value as Partial<ForkVisualizationBlock>
  return block.type === 'visualization'
    && block.format === 'ant-chat.visualization.v1'
    && Boolean(block.source && block.source.type === 'file_id' && typeof block.source.file_id === 'string')
}

/**
 * Generate stable remapped IDs for tool references within a fork.
 * Uses a persistent map so tool-call and tool-result blocks that
 * share the same original ID keep the same new ID, preserving pairing.
 */
function remapToolRef(originalId: string, toolCallIdMap: Map<string, string>): string {
  const existing = toolCallIdMap.get(originalId)
  if (existing) {
    return existing
  }
  const newId = requireCryptoUUID()
  toolCallIdMap.set(originalId, newId)
  return newId
}

let _cryptoUUID: (() => string) | undefined

function requireCryptoUUID(): string {
  if (!_cryptoUUID) {
    // eslint-disable-next-line ts/no-require-imports
    const { randomUUID } = require('node:crypto') as { randomUUID: () => string }
    _cryptoUUID = randomUUID
  }
  return _cryptoUUID()
}
