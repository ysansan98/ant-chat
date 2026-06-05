import type { ConversationsSettingsSchema } from '@ant-chat/shared'
import { createContext } from 'react'

export const DEFAULT_SETTINGS: ConversationsSettingsSchema = {
  modelId: '',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 1000,
  compaction: {
    enabled: true,
    thresholdPercent: 70,
    keepRecentPairs: 3,
  },
  lastCompactedMessageId: undefined,
}

export const ChatSettingsContext = createContext<{
  settings: typeof DEFAULT_SETTINGS
  updateSettings: (newSettings: Partial<typeof DEFAULT_SETTINGS>) => void
} | null>(null)
