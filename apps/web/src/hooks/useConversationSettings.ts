import type { CompactionSettingsSchema, ConversationsSettingsSchema } from '@ant-chat/shared'
import { has } from 'lodash-es'
import { useEffect } from 'react'
import { useImmer } from 'use-immer'
import { getConversationByIdAction, updateConversationsSettingsAction } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'

const DEFAULT_COMPACTION: CompactionSettingsSchema = {
  enabled: true,
  thresholdPercent: 70,
  keepRecentPairs: 3,
}

const DEFAULT_SETTINGS: ConversationsSettingsSchema = {
  modelId: '',
  systemPrompt: '',
  temperature: 0.7,
  maxTokens: 1000,
  compaction: DEFAULT_COMPACTION,
}

export function useConversationSettings() {
  const currentConversationsId = useMessagesStore(state => state.activeConversationsId)
  const conversations = getConversationByIdAction(currentConversationsId)

  const [settings, _updateSettings] = useImmer(conversations?.settings || { ...DEFAULT_SETTINGS })

  async function updateSettings(options: Partial<ConversationsSettingsSchema>) {
    const updatedSettings: Partial<ConversationsSettingsSchema> = {}

    if (has(options, 'modelId')) {
      updatedSettings.modelId = options.modelId || ''
    }
    if (has(options, 'systemPrompt')) {
      updatedSettings.systemPrompt = options.systemPrompt
    }
    if (has(options, 'temperature')) {
      updatedSettings.temperature = options.temperature
    }
    if (has(options, 'maxTokens')) {
      updatedSettings.maxTokens = options.maxTokens
    }
    if (has(options, 'compaction')) {
      updatedSettings.compaction = options.compaction
    }
    if (has(options, 'lastCompactedAt')) {
      updatedSettings.lastCompactedAt = options.lastCompactedAt
    }

    if (currentConversationsId) {
      await updateConversationsSettingsAction(currentConversationsId, updatedSettings)
    }

    _updateSettings((draft) => {
      for (const key in updatedSettings) {
        if (Object.prototype.hasOwnProperty.call(updatedSettings, key)) {
          ;(draft as any)[key] = (updatedSettings as any)[key]
        }
      }
    })
  }

  useEffect(() => {
    _updateSettings((draft) => {
      if (conversations?.settings) {
        draft.modelId = conversations.settings.modelId || ''
        draft.systemPrompt = conversations.settings.systemPrompt || ''
        draft.temperature = conversations.settings.temperature || 0.7
        draft.maxTokens = conversations.settings.maxTokens || 1000
        draft.compaction = conversations.settings.compaction || DEFAULT_COMPACTION
        draft.lastCompactedAt = conversations.settings.lastCompactedAt
      }
      else {
        draft.modelId = ''
        draft.systemPrompt = ''
        draft.temperature = 0.7
        draft.maxTokens = 1000
        draft.compaction = DEFAULT_COMPACTION
        draft.lastCompactedAt = undefined
      }
    })
  }, [currentConversationsId, _updateSettings, conversations?.settings])

  return {
    settings,
    updateSettings,
  }
}
