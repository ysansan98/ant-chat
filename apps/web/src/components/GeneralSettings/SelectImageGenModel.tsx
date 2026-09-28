import type { AllAvailableModelsSchema } from '@ant-chat/shared'
import type { ModelSelectValue } from '@/components/Common/ModelSelect'
import { ChevronDown } from 'lucide-react'
import { ModelSelect } from '@/components/Common/ModelSelect'
import { useAllAvailableModels } from '@/hooks/useAllAvailableModels'
import { setImageGenModel, useGeneralSettingsStore } from '@/store/generalSettings'

/** 过滤支持图片输出（outputModalities 含 image）的模型，避免生图任务选到纯文本模型。 */
function filterImageGenModels(providers: AllAvailableModelsSchema[]) {
  return providers
    .map(provider => ({
      ...provider,
      models: provider.models.filter(model => model.capabilities?.outputModalities?.includes('image')),
    }))
    .filter(provider => provider.models.length > 0)
}

export function SelectImageGenModel() {
  const { data: providers } = useAllAvailableModels()

  const imageGenModelId = useGeneralSettingsStore(state => state.imageGenModelId)
  const imageGenProviderId = useGeneralSettingsStore(state => state.imageGenProviderId)

  const value: ModelSelectValue = { modelId: imageGenModelId, providerId: imageGenProviderId }
  const hasSelection = Boolean(imageGenModelId && imageGenProviderId)

  const selectedProvider = providers?.find(p => p.id === imageGenProviderId)
  const selectedModelName = selectedProvider?.models.find(m => m.id === imageGenModelId)?.name

  return (
    <ModelSelect
      value={value}
      onChange={(nextValue) => {
        if (nextValue.modelId && nextValue.providerId) {
          setImageGenModel(nextValue.modelId, nextValue.providerId)
        }
        else {
          setImageGenModel('', '')
        }
      }}
      options={filterImageGenModels(providers ?? [])}
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
