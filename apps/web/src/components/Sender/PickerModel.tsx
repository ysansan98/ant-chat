import type { AllAvailableModelsSchema } from '@ant-chat/shared'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import { useRequest } from 'ahooks'
import { Settings } from 'lucide-react'
import React from 'react'
import { providerApi } from '@/api/providerApi'
import { ModelSelect } from '@/components/Common/ModelSelect'
import { PROVIDER_CHANGED_EVENT } from '@/constants/providerEvents'
import { ModelParameterSettingsPanel } from './ModelParameterSettingsPanel'
import { ProviderLogoDisplay } from './renderProviderLogo'

interface ModelControlPanelProps {
  value: { modelId: string, providerId: string }
  onChange?: (info: { modelId: string, providerId: string, maxTokens: number, temperature: number }) => void
}

export function ModelControlPanel({ value, onChange }: ModelControlPanelProps) {
  const [openPopover, setOpenPopover] = React.useState(false)
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
      onChange?.({ modelId: firstModel.id, providerId: firstModel.providerId, maxTokens: firstModel.maxTokens, temperature: firstModel.temperature })
    }
  }, [activeProviderServiceInfo, onChange, value])

  return (
    <div
      className={`
      model-control-trigger flex h-8 items-center rounded-md border border-solid overflow-hidden
      border-(--border-color)
    `}
    >
      {/* Model selector - 2-level cascading submenu */}
      <ModelSelect
        value={value}
        onChange={nextInfo => onChange?.(nextInfo)}
        options={data}
        className={`
          flex cursor-default items-center gap-1 pl-2 h-full
          hover:bg-(--hover-bg-color)
          max-sm:size-full max-sm:justify-center max-sm:gap-0 max-sm:pl-0
          outline-hidden
        `}
      >
        <ProviderLogoDisplay providerId={activeProviderServiceInfo?.id || ''} />
        <div className="flex max-w-30 items-center truncate text-xs font-medium max-sm:hidden">
          <span className="truncate">{currentModelInfo?.name}</span>
          <span className="px-2">›</span>
        </div>
      </ModelSelect>

      {/* Settings gear - separate Popover */}
      <Popover open={openPopover} onOpenChange={setOpenPopover}>
        <PopoverTrigger
          className={`
          model-control-settings h-full flex items-center justify-center
          px-1 hover:bg-(--hover-bg-color)
          cursor-pointer outline-hidden
        `}
        >
          <Settings size={16} />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <ModelParameterSettingsPanel />
        </PopoverContent>
      </Popover>
    </div>
  )
}
