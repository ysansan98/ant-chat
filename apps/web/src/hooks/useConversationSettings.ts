import type { ConversationsSettingsSchema } from '@ant-chat/shared'
import { DEFAULT_COMPACTION_SETTINGS } from '@ant-chat/shared'
import { has } from 'lodash-es'
import { useEffect, useRef } from 'react'
import { useImmer } from 'use-immer'
import { getConversationByIdAction, updateConversationInstructionsAction, updateConversationsSettingsAction } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'

const DEFAULT_SETTINGS: ConversationsSettingsSchema = {
  modelId: '',
  providerId: '',
  temperature: 0.7,
  maxOutputTokens: 1000,
  reasoningEffort: undefined,
  compaction: DEFAULT_COMPACTION_SETTINGS,
}

export function useConversationSettings() {
  const currentConversationsId = useMessagesStore(state => state.activeConversationsId)
  const conversations = getConversationByIdAction(currentConversationsId)

  const [settings, _updateSettings] = useImmer(conversations?.settings || { ...DEFAULT_SETTINGS })
  const [conversationInstructions, _updateConversationInstructions] = useImmer(conversations?.conversationInstructions ?? '')
  const persistedInstructionsRef = useRef({
    conversationId: currentConversationsId,
    value: conversations?.conversationInstructions ?? '',
  })
  const instructionSaveQueueRef = useRef<Promise<void>>(Promise.resolve())

  async function updateSettings(options: Partial<ConversationsSettingsSchema>) {
    const updatedSettings: Partial<ConversationsSettingsSchema> = {}

    if (has(options, 'modelId')) {
      updatedSettings.modelId = options.modelId || ''
    }
    if (has(options, 'providerId')) {
      updatedSettings.providerId = options.providerId || ''
    }
    if (has(options, 'temperature')) {
      updatedSettings.temperature = options.temperature
    }
    if (has(options, 'maxOutputTokens')) {
      updatedSettings.maxOutputTokens = options.maxOutputTokens
    }
    if (has(options, 'reasoningEffort')) {
      updatedSettings.reasoningEffort = options.reasoningEffort
    }
    if (has(options, 'compaction')) {
      updatedSettings.compaction = options.compaction
    }

    if (currentConversationsId) {
      await updateConversationsSettingsAction(currentConversationsId, updatedSettings)
    }

    _updateSettings((draft) => {
      Object.assign(draft, updatedSettings)
    })
  }

  function setConversationInstructions(value: string) {
    _updateConversationInstructions(value)
  }

  async function updateConversationInstructions(value: string) {
    _updateConversationInstructions(value)
    const conversationId = currentConversationsId
    if (!conversationId) {
      return
    }

    const persist = async () => {
      const persisted = persistedInstructionsRef.current
      if (persisted.conversationId === conversationId && persisted.value === value) {
        return
      }
      await updateConversationInstructionsAction(conversationId, value)
      persistedInstructionsRef.current = { conversationId, value }
    }
    const queued = instructionSaveQueueRef.current.then(persist, persist)
    instructionSaveQueueRef.current = queued
    await queued
  }

  useEffect(() => {
    _updateSettings((draft) => {
      if (conversations?.settings) {
        draft.modelId = conversations.settings.modelId || ''
        draft.providerId = conversations.settings.providerId || ''
        draft.temperature = conversations.settings.temperature ?? 0.7
        draft.maxOutputTokens = conversations.settings.maxOutputTokens ?? 1000
        draft.reasoningEffort = conversations.settings.reasoningEffort
        draft.compaction = conversations.settings.compaction || DEFAULT_COMPACTION_SETTINGS
      }
      else {
        draft.modelId = ''
        draft.providerId = ''
        draft.temperature = 0.7
        draft.maxOutputTokens = 1000
        draft.reasoningEffort = undefined
        draft.compaction = DEFAULT_COMPACTION_SETTINGS
      }
    })
    const nextInstructions = conversations?.conversationInstructions ?? ''
    _updateConversationInstructions(nextInstructions)
    persistedInstructionsRef.current = {
      conversationId: currentConversationsId,
      value: nextInstructions,
    }
  }, [currentConversationsId, _updateConversationInstructions, _updateSettings, conversations?.conversationInstructions, conversations?.settings])

  return {
    settings,
    conversationInstructions,
    setConversationInstructions,
    updateSettings,
    updateConversationInstructions,
  }
}
