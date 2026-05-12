import type { IMessageStore, StreamProcessor } from '@ant-chat/shared'

const STREAM_MESSAGE_UPDATE_INTERVAL_MS = 80

export function createStreamProcessor(messageStore: IMessageStore): StreamProcessor {
  let modelText = ''
  let reasoningText = ''
  let latestUsage: Record<string, number> | undefined
  let lastUpdateAt = 0

  return {
    async onChunk(chunk, msgId) {
      for (const item of chunk.content || []) {
        if (item.type === 'text' && item.text) {
          modelText += item.text
        }
      }
      if (chunk.reasoningContent) {
        reasoningText += chunk.reasoningContent
      }
      if (chunk.usage) {
        latestUsage = { ...chunk.usage }
      }

      const now = Date.now()
      if (now - lastUpdateAt < STREAM_MESSAGE_UPDATE_INTERVAL_MS) {
        return
      }
      if (!modelText && !reasoningText) {
        return
      }
      lastUpdateAt = now

      await messageStore.updateMessage(msgId, {
        status: 'loading',
        content: [{ type: 'text', text: modelText.trim() || '...' }],
        reasoningContent: reasoningText,
        usage: latestUsage,
      })
    },

    async flush(msgId) {
      await messageStore.updateMessage(msgId, {
        status: 'loading',
        content: [{ type: 'text', text: modelText.trim() || '...' }],
        reasoningContent: reasoningText,
        usage: latestUsage,
      })
    },
  }
}
