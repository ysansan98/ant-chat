import type { AllAvailableModelsSchema, ReasoningEffortLevel } from '@ant-chat/shared'

import { useRequest } from 'ahooks'
import { ChevronDown } from 'lucide-react'
import React from 'react'
import { providerApi } from '@/api/providerApi'
import { ModelSelect } from '@/components/Common/ModelSelect'
import { PROVIDER_CHANGED_EVENT } from '@/constants/providerEvents'

interface ModelControlPanelProps {
  value: { modelId: string, providerId: string }
  onChange?: (
    info: { modelId: string, providerId: string },
    source: 'user' | 'fallback',
  ) => void
  reasoningEffort?: ReasoningEffortLevel
  onReasoningEffortChange?: (value: ReasoningEffortLevel | undefined) => void
}

function getSupportedReasoningEffort(
  model: AllAvailableModelsSchema['models'][number] | undefined,
  reasoningEffort: ReasoningEffortLevel | undefined,
): ReasoningEffortLevel | undefined {
  return reasoningEffort && model?.capabilities?.reasoningLevels?.includes(reasoningEffort)
    ? reasoningEffort
    : undefined
}

export function ModelControlPanel({ value, onChange, reasoningEffort, onReasoningEffortChange }: ModelControlPanelProps) {
  const { data, refresh } = useRequest<AllAvailableModelsSchema[], []>(providerApi.getAllAbvailableModels)

  React.useEffect(() => {
    const handleProviderChanged = () => {
      refresh()
    }
    window.addEventListener(PROVIDER_CHANGED_EVENT, handleProviderChanged)
    return () => {
      window.removeEventListener(PROVIDER_CHANGED_EVENT, handleProviderChanged)
    }
  }, [refresh])

  const activeProviderServiceInfo = !value.modelId ? data?.[0] : data?.find(item => item.id === value.providerId)
  const currentModelInfo = activeProviderServiceInfo?.models.find(model => model.id === value.modelId && model.providerId === value.providerId)
  const fallbackModel = activeProviderServiceInfo?.models[0] ?? data?.[0]?.models[0]

  const handleModelChange = React.useCallback((nextInfo: { modelId: string, providerId: string }, source: 'user' | 'fallback') => {
    const nextProvider = data?.find(provider => provider.id === nextInfo.providerId)
    const nextModel = nextProvider?.models.find(model => model.id === nextInfo.modelId)
    onReasoningEffortChange?.(getSupportedReasoningEffort(nextModel, reasoningEffort))
    onChange?.(nextInfo, source)
  }, [data, onChange, onReasoningEffortChange, reasoningEffort])

  React.useEffect(() => {
    if (currentModelInfo || !fallbackModel) {
      return
    }
    handleModelChange({ modelId: fallbackModel.id, providerId: fallbackModel.providerId }, 'fallback')
  }, [currentModelInfo, fallbackModel, handleModelChange])

  return (
    <div
      className={`
      model-control-trigger flex h-8 items-center overflow-hidden rounded-md
    `}
    >
      {/* Model selector - 2-level cascading submenu */}
      <ModelSelect
        value={value}
        onChange={nextInfo => handleModelChange(nextInfo, 'user')}
        options={data}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={onReasoningEffortChange}
        className={`
          flex h-full cursor-default items-center gap-1 pl-2
          outline-hidden
          hover:bg-(--hover-bg-color) max-sm:size-full max-sm:justify-center max-sm:gap-0
          max-sm:pl-0
        `}
      >
        <div className="flex items-center truncate text-xs font-medium max-sm:hidden">
          <span className="truncate">{currentModelInfo?.name}</span>
          <ChevronDown className="size-3.5" />
        </div>
      </ModelSelect>
    </div>
  )
}
