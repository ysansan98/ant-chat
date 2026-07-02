import type { AddMessage, IMessage, RunBuiltinCommandResult } from '@ant-chat/shared'
import type { AppDataContext } from '../../data'

export async function runFork(params: {
  appDataContext: AppDataContext
  sourceConversationId: string
  workspacePath: string
}): Promise<RunBuiltinCommandResult> {
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
    const addMsg = messageToAddMessage(msg, forkConversation.id, idMap, toolCallIdMap)
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
function messageToAddMessage(
  msg: IMessage,
  forkConvId: string,
  idMap: Map<string, string>,
  toolCallIdMap: Map<string, string>,
): AddMessage {
  const remappedContent = msg.content.map((block) => {
    if (block.type === 'tool-call') {
      return { ...block, toolCallId: remapToolRef(block.toolCallId, toolCallIdMap) }
    }
    if (block.type === 'tool-result') {
      return { ...block, toolCallId: remapToolRef(block.toolCallId, toolCallIdMap) }
    }
    return block
  })

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
      }

    case 'assistant':
      return {
        ...base,
        role: 'assistant' as const,
        status: (msg.status as 'success' | 'error' | 'loading' | 'typing' | 'cancel') || 'success',
        modelInfo: msg.modelInfo || { provider: '', model: '' },
        reasoningContent: msg.reasoningContent,
        usage: msg.usage,
        durationMs: msg.durationMs,
      }

    case 'tool':
      return {
        ...base,
        role: 'tool' as const,
        status: (msg.status === 'error' ? 'error' : 'success') as 'success' | 'error',
      }

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
      }

    default:
      throw new Error(`Unknown message role: ${(msg as IMessage).role}`)
  }
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
