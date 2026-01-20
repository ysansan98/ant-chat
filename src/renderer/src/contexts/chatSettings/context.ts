import type { ConversationsSettingsSchema } from '@ant-chat/shared'
import { createContext } from 'react'

export const DEFAULT_SETTINGS: ConversationsSettingsSchema = {
  modelId: '',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 1000,
}

export const ChatSettingsContext = createContext<{
  settings: typeof DEFAULT_SETTINGS
  updateSettings: (newSettings: Partial<typeof DEFAULT_SETTINGS>) => void
} | null>(null)
