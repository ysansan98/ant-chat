import type { handleChatCompletionsOptions } from '@ant-chat/shared'
import { useGeneralSettingsStore } from '@/store/generalSettings'
import { emitter } from '@/utils/ipc-bus'

function sendChatCompletions(options: handleChatCompletionsOptions) {
  return emitter.send('chat:send-chat-completions', options)
}

function cancelChatCompletions(conversationdsId: string) {
  emitter.send('chat:cancel-chat-completions', conversationdsId)
}

async function initConversationsTitle(conversationsId: string) {
  const { assistantModelId: modelId } = useGeneralSettingsStore.getState()
  return await emitter.invoke('chat:create-conversations-title', { modelId, conversationsId })
}

export default {
  sendChatCompletions,
  initConversationsTitle,
  cancelChatCompletions,
}
