import type { ConversationsSettingsSchema } from '@ant-chat/shared'
import { DEFAULT_COMPACTION_SETTINGS } from '@ant-chat/shared'
import { has } from 'lodash-es'
import { useEffect, useRef } from 'react'
import { useImmer } from 'use-immer'
import { getConversationByIdAction, updateConversationInstructionsAction, updateConversationsSettingsAction } from '@/store/conversation'
import { useGeneralSettingsStore } from '@/store/generalSettings'
import { useMessagesStore } from '@/store/messages'

const DEFAULT_SETTINGS: ConversationsSettingsSchema = {
  modelId: '',
  providerId: '',
  temperature: 0.7,
  maxOutputTokens: 1000,
  reasoningEffort: undefined,
  compaction: DEFAULT_COMPACTION_SETTINGS,
}

function getInitialSettings(
  conversationSettings: ConversationsSettingsSchema | undefined,
  defaultModelId: string,
  defaultProviderId: string,
): ConversationsSettingsSchema {
  const hasConversationModel = Boolean(conversationSettings?.modelId)
  return {
    ...DEFAULT_SETTINGS,
    ...conversationSettings,
    modelId: hasConversationModel ? conversationSettings!.modelId : defaultModelId,
    providerId: hasConversationModel ? conversationSettings!.providerId : defaultProviderId,
    compaction: conversationSettings?.compaction || DEFAULT_COMPACTION_SETTINGS,
  }
}

export function useConversationSettings() {
  const currentConversationsId = useMessagesStore(state => state.activeConversationsId)
  const conversations = getConversationByIdAction(currentConversationsId)
  const defaultModelId = useGeneralSettingsStore(state => state.defaultModelId)
  const defaultProviderId = useGeneralSettingsStore(state => state.defaultProviderId)

  const [settings, _updateSettings] = useImmer(getInitialSettings(conversations?.settings, defaultModelId, defaultProviderId))
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
      Object.assign(draft, getInitialSettings(conversations?.settings, defaultModelId, defaultProviderId))
    })
    const nextInstructions = conversations?.conversationInstructions ?? ''
    _updateConversationInstructions(nextInstructions)
    persistedInstructionsRef.current = {
      conversationId: currentConversationsId,
      value: nextInstructions,
    }
  }, [currentConversationsId, defaultModelId, defaultProviderId, _updateConversationInstructions, _updateSettings, conversations?.conversationInstructions, conversations?.settings])

  return {
    settings,
    conversationInstructions,
    setConversationInstructions,
    updateSettings,
    updateConversationInstructions,
  }
}
