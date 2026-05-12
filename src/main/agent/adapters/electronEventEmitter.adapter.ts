import type { IAgentEventEmitter } from '@ant-chat/shared'
import { addMessage, createAIMessage, updateMessage as dbUpdateMessage, getConversationById, updateConversation } from '@main/db/services'
import { sendToRenderer } from '@main/utils/ipc-events'
import { getMainWindow } from '@main/window'

const STREAM_UPDATE_INTERVAL_MS = 80

interface TurnState {
  msgId: string
  modelText: string
  reasoningText: string
  latestUsage: Record<string, number> | undefined
  lastUpdateAt: number
}

export function createElectronEventEmitter(): IAgentEventEmitter {
  const turns = new Map<string, TurnState>()

  function ipc(channel: string, data: unknown) {
    const win = getMainWindow()
    if (!win)
      return
    sendToRenderer(win.webContents, channel, data)
  }

  async function flushTurn(meta: TurnState) {
    await dbUpdateMessage({ id: meta.msgId, role: 'assistant', status: 'loading', content: [{ type: 'text', text: meta.modelText.trim() || '...' }], reasoningContent: meta.reasoningText, usage: meta.latestUsage } as any)
  }

  return {
    emitTaskUpdated(task) {
      ipc('agent:state-updated', { task })
    },

    emitApprovalRequired(taskId, conversationId, pendingAction) {
      ipc('agent:approval-required', { taskId, conversationId, pendingAction })
    },

    async emitTurnStarted({ conversationId, model }) {
      const msg = await createAIMessage(conversationId, { provider: model.provider, providerId: model.providerId, model: model.name })
      turns.set(conversationId, { msgId: msg.id, modelText: '', reasoningText: '', latestUsage: undefined, lastUpdateAt: 0 })
    },

    async emitTurnChunk({ conversationId, accumulatedText, chunk }) {
      const meta = turns.get(conversationId)
      if (!meta)
        return

      meta.modelText = accumulatedText
      if (chunk.reasoningContent)
        meta.reasoningText += chunk.reasoningContent
      if (chunk.usage)
        meta.latestUsage = { ...chunk.usage }

      const now = Date.now()
      if (now - meta.lastUpdateAt < STREAM_UPDATE_INTERVAL_MS)
        return
      if (!meta.modelText && !meta.reasoningText)
        return
      meta.lastUpdateAt = now

      await flushTurn(meta)
    },

    async emitTurnToolCalls({ conversationId, text, toolCalls }) {
      const meta = turns.get(conversationId)
      if (!meta)
        return

      meta.modelText = text
      await dbUpdateMessage({
        id: meta.msgId,
        role: 'assistant',
        status: 'success',
        content: [{ type: 'text', text }],
        toolCalls: [...toolCalls],
      } as any)
    },

    async emitTurnFinished({ conversationId, text, status }) {
      const meta = turns.get(conversationId)
      if (!meta)
        return

      await flushTurn(meta)
      await dbUpdateMessage({
        id: meta.msgId,
        role: 'assistant',
        status,
        content: status === 'error'
          ? [{ type: 'error', error: text }]
          : [{ type: 'text', text }],
        toolCalls: undefined,
      } as any)
      turns.delete(conversationId)
    },

    async emitCompactionSaved({ conversationId, summary, compactedAt }) {
      await addMessage({ convId: conversationId, role: 'user', status: 'success', content: [{ type: 'text', text: `__COMPACTION__\n${summary}` }], images: [], attachments: [] } as any)
      const conv = await getConversationById(conversationId)
      if (conv) {
        await updateConversation({ id: conversationId, settings: { ...conv.settings, lastCompactedAt: compactedAt, lastCompactionSummary: summary } } as any)
      }
    },
  }
}
