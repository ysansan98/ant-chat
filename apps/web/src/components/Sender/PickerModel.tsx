import type { AllAvailableModelsSchema, ReasoningEffortLevel } from '@ant-chat/shared'

import { useRequest } from 'ahooks'
import { ChevronDown } from 'lucide-react'
import React from 'react'
import { providerApi } from '@/api/providerApi'
import { ModelSelect } from '@/components/Common/ModelSelect'
import { PROVIDER_CHANGED_EVENT } from '@/constants/providerEvents'

interface ModelControlPanelProps {
  value: { modelId: string, providerId: string }
  onChange?: (info: { modelId: string, providerId: string, maxOutputTokens: number, temperature: number }) => void
  reasoningEffort?: ReasoningEffortLevel
  onReasoningEffortChange?: (value: ReasoningEffortLevel | undefined) => void
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
  const currentModelInfo = activeProviderServiceInfo?.models.find(model => model.id === value.modelId)

  React.useEffect(() => {
    if (!value.modelId && activeProviderServiceInfo?.models.length) {
      const firstModel = activeProviderServiceInfo.models[0]
      onChange?.({ modelId: firstModel.id, providerId: firstModel.providerId, maxOutputTokens: firstModel.maxOutputTokens, temperature: firstModel.temperature })
    }
  }, [activeProviderServiceInfo, onChange, value])

  return (
    <div
      className={`
      model-control-trigger flex h-8 items-center overflow-hidden rounded-md
    `}
    >
      {/* Model selector - 2-level cascading submenu */}
      <ModelSelect
        value={value}
        onChange={nextInfo => onChange?.(nextInfo)}
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
