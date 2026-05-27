import { use } from 'react'
import { useConversationSettings } from '@/hooks/useConversationSettings'
import { ChatSettingsContext } from './context'

export function ChatSettingsProvider({ children }: { children: React.ReactNode }) {
  const { settings, updateSettings } = useConversationSettings()

  return (
    <ChatSettingsContext value={{ settings, updateSettings }}>
      {children}
    </ChatSettingsContext>
  )
}

export function useChatSettingsContext() {
  const result = use(ChatSettingsContext)
  if (!result) {
    throw new Error('useChatSettingsContext must be used within a ChatSettingsProvider')
  }
  return result
}
