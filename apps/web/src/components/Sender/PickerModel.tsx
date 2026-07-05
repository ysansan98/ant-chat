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
import { PROVIDER_CHANGED_EVENT } from '@/constants/providerEvents'
import { ModelParameterSettingsPanel } from './ModelParameterSettingsPanel'
import { ProviderLogoDisplay } from './renderProviderLogo'
import { SelectModel } from './SelectModel'

interface ModelControlPanelProps {
  value: { modelId: string, providerId: string }
  onChange?: (info: { modelId: string, providerId: string, maxTokens: number, temperature: number }) => void
}

export function ModelControlPanel({ value, onChange }: ModelControlPanelProps) {
  const [openPopover, setOpenPopover] = React.useState(false)
  const [panel, setPanel] = React.useState<'select' | 'parameter'>('select')
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
    <Popover
      open={openPopover}
      onOpenChange={(nextOpen) => {
        setOpenPopover(nextOpen)
        if (!nextOpen && panel === 'parameter') {
          setPanel('select')
        }
      }}
    >
      <PopoverTrigger
        nativeButton={false}
        render={(
          <div
            className={`
            model-control-trigger flex h-8 cursor-pointer items-center rounded-md border border-solid overflow-hidden
            border-(--border-color)
            max-sm:size-8 max-sm:justify-center
          `}
          >
            <div className={`
            flex items-center gap-1 pl-2
            hover:bg-(--hover-bg-color) h-full
            max-sm:size-full max-sm:justify-center max-sm:gap-0 max-sm:pl-0
          `}
            >
              <ProviderLogoDisplay providerId={activeProviderServiceInfo?.id || ''} />
              <div className="flex max-w-30 items-center truncate text-xs font-medium max-sm:hidden">
                <span className="truncate">{currentModelInfo?.name}</span>
                <span className="px-2">›</span>
              </div>
            </div>
            <div
              className={`
              model-control-settings h-full flex items-center justify-center overflow-hidden
            `}
            >
              <span
                role="button"
                tabIndex={0}
                className={`
                size-full
                flex items-center justify-center
                hover:bg-(--hover-bg-color)
              `}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setPanel('parameter')
                  setOpenPopover(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    e.stopPropagation()
                    setPanel('parameter')
                    setOpenPopover(true)
                  }
                }}
              >
                <Settings size={16} />
              </span>
            </div>
          </div>
        )}
      />
      <PopoverContent align="start" className="w-80 p-0">
        {panel === 'select'
          ? (
              <SelectModel
                value={value}
                onChange={(nextInfo) => {
                  onChange?.(nextInfo)
                  setOpenPopover(false)
                }}
                options={data}
              />
            )
          : <ModelParameterSettingsPanel />}
      </PopoverContent>
    </Popover>
  )
}
