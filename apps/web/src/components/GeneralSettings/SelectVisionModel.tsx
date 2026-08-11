import type { AllAvailableModelsSchema } from '@ant-chat/shared'
import type { ModelSelectValue } from '@/components/Common/ModelSelect'
import { ChevronDown } from 'lucide-react'
import { ModelSelect } from '@/components/Common/ModelSelect'
import { useAllAvailableModels } from '@/hooks/useAllAvailableModels'
import { setVisionModel, useGeneralSettingsStore } from '@/store/generalSettings'

/** 过滤支持图片输入（inputModalities 含 image）的模型，避免视觉任务选到纯文本模型。 */
function filterVisionModels(providers: AllAvailableModelsSchema[]) {
  return providers
    .map(provider => ({
      ...provider,
      models: provider.models.filter(model => model.capabilities?.inputModalities?.includes('image')),
    }))
    .filter(provider => provider.models.length > 0)
}

export function SelectVisionModel() {
  const { data: providers } = useAllAvailableModels()

  const visionModelId = useGeneralSettingsStore(state => state.visionModelId)
  const visionProviderId = useGeneralSettingsStore(state => state.visionProviderId)

  const value: ModelSelectValue = { modelId: visionModelId, providerId: visionProviderId }
  const hasSelection = Boolean(visionModelId && visionProviderId)

  const selectedProvider = providers?.find(p => p.id === visionProviderId)
  const selectedModelName = selectedProvider?.models.find(m => m.id === visionModelId)?.name

  return (
    <ModelSelect
      value={value}
      onChange={(nextValue) => {
        if (nextValue.modelId && nextValue.providerId) {
          setVisionModel(nextValue.modelId, nextValue.providerId)
        }
        else {
          setVisionModel('', '')
        }
      }}
      options={filterVisionModels(providers ?? [])}
      allowUnset={true}
      unsetLabel="未设置"
      className={`
        flex h-8 w-52 cursor-default items-center justify-between gap-2 rounded-md
        border border-input bg-transparent px-3 py-1 text-sm
        outline-hidden
        hover:bg-accent
      `}
    >
      <span className="truncate">
        {hasSelection ? selectedModelName : '未设置'}
      </span>
      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
    </ModelSelect>
  )
}
