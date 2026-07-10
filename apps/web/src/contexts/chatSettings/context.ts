import type { ConversationsSettingsSchema } from '@ant-chat/shared'
import { DEFAULT_COMPACTION_SETTINGS } from '@ant-chat/shared'
import { createContext } from 'react'

export const DEFAULT_SETTINGS: ConversationsSettingsSchema = {
  modelId: '',
  providerId: '',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 1000,
  reasoningEffort: undefined,
  compaction: DEFAULT_COMPACTION_SETTINGS,
}

export const ChatSettingsContext = createContext<{
  settings: typeof DEFAULT_SETTINGS
  updateSettings: (newSettings: Partial<typeof DEFAULT_SETTINGS>) => void
} | null>(null)
