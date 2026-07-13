import type { ConversationsSettingsSchema } from '@ant-chat/shared'
import { DEFAULT_COMPACTION_SETTINGS } from '@ant-chat/shared'
import { createContext } from 'react'

export const DEFAULT_SETTINGS: ConversationsSettingsSchema = {
  modelId: '',
  providerId: '',
  temperature: 0.7,
  maxOutputTokens: 1000,
  reasoningEffort: undefined,
  compaction: DEFAULT_COMPACTION_SETTINGS,
}

export const ChatSettingsContext = createContext<{
  settings: typeof DEFAULT_SETTINGS
  conversationInstructions: string
  setConversationInstructions: (conversationInstructions: string) => void
  updateSettings: (newSettings: Partial<typeof DEFAULT_SETTINGS>) => Promise<void>
  updateConversationInstructions: (conversationInstructions: string) => Promise<void>
} | null>(null)
