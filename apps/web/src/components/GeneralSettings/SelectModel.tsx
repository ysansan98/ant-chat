import type { ModelSelectValue } from '@/components/Common/ModelSelect'
import { ChevronDown } from 'lucide-react'
import { ModelSelect } from '@/components/Common/ModelSelect'
import { useAllAvailableModels } from '@/hooks/useAllAvailableModels'
import { setAssistantModel, setAssistantReasoningEffort, useGeneralSettingsStore } from '@/store/generalSettings'

export function SelectModel() {
  const { data: providers } = useAllAvailableModels()

  const assistantModelId = useGeneralSettingsStore(state => state.assistantModelId)
  const assistantProviderId = useGeneralSettingsStore(state => state.assistantProviderId)
  const reasoningEffort = useGeneralSettingsStore(state => state.reasoningEffort)

  const value: ModelSelectValue = { modelId: assistantModelId, providerId: assistantProviderId }
  const hasSelection = Boolean(assistantModelId && assistantProviderId)

  const selectedProvider = providers?.find(p => p.id === assistantProviderId)
  const selectedModelName = selectedProvider?.models.find(m => m.id === assistantModelId)?.name

  return (
    <ModelSelect
      value={value}
      onChange={(nextValue) => {
        if (nextValue.modelId && nextValue.providerId) {
          setAssistantModel(nextValue.modelId, nextValue.providerId)
        }
        else {
          setAssistantModel('', '')
        }
      }}
      options={providers}
      allowUnset={true}
      unsetLabel="使用当前会话模型"
      reasoningEffort={reasoningEffort}
      onReasoningEffortChange={value => setAssistantReasoningEffort(value)}
      className={`
        flex h-8 w-52 cursor-default items-center justify-between gap-2 rounded-md
        border border-input bg-transparent px-3 py-1 text-sm
        outline-hidden
        hover:bg-accent
      `}
    >
      <span className="truncate">
        {hasSelection ? selectedModelName : '使用当前会话模型'}
      </span>
      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
    </ModelSelect>
  )
}
