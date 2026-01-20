import { handleChatCompletions } from '@main/ai-providers/services/chat-service'
import { StreamAbortController } from '@main/ai-providers/utils/StreamAbortController'
import { mainListener } from '@main/utils/ipc-events-bus'

export function registerChatHandlers() {
  mainListener.on('chat:send-chat-completions', async (_, options) => {
    handleChatCompletions(options)
  })

  mainListener.on('chat:cancel-chat-completions', async (_, conversationsId: string) => {
    StreamAbortController.abortConversationsStream(conversationsId)
  })
}
