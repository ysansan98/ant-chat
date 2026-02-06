import type { handleChatCompletionsOptions } from '@ant-chat/shared'
import { useGeneralSettingsStore } from '@/store/generalSettings'
import { emitter } from '@/utils/ipc-bus'

function sendChatCompletions(options: handleChatCompletionsOptions) {
  return emitter.send('chat:send-chat-completions', options)
}

function cancelChatCompletions(conversationdsId: string) {
  emitter.send('chat:cancel-chat-completions', conversationdsId)
}

async function initConversationsTitle(conversationsId: string, modelId?: string) {
  const { assistantModelId } = useGeneralSettingsStore.getState()
  const finalModelId = modelId || assistantModelId
  return await emitter.invoke('chat:create-conversations-title', { modelId: finalModelId, conversationsId })
}

export default {
  sendChatCompletions,
  initConversationsTitle,
  cancelChatCompletions,
}
