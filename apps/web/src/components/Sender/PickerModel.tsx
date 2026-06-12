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
  value: string
  onChange?: (modelInfo: AllAvailableModelsSchema['models'][number]) => void
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

  const activeProviderServiceInfo = !value ? data?.[0] : data?.find(item => item.models.some(model => model.id === value))
  const currentModelInfo = activeProviderServiceInfo?.models.find(model => model.id === value)

  React.useEffect(() => {
    if (!value && activeProviderServiceInfo?.models.length) {
      onChange?.(activeProviderServiceInfo?.models[0])
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
      <PopoverTrigger asChild>
        <div
          className={`
            group grid h-8 cursor-pointer grid-cols-[max-content_0fr] rounded-md border border-solid
            border-(--border-color) transition-all duration-300
            hover:grid-cols-[max-content_1fr]
          `}
        >
          <div className={`
            flex items-center gap-1 pl-2
            hover:bg-(--hover-bg-color)
          `}
          >
            <ProviderLogoDisplay providerId={activeProviderServiceInfo?.id || ''} />
            <div className="flex max-w-30 items-center truncate text-xs font-medium">
              <span className="truncate">{currentModelInfo?.name}</span>
              <span className="px-2">›</span>
            </div>
          </div>
          <div className="flex items-center justify-center overflow-hidden">
            <span
              role="button"
              tabIndex={0}
              className={`
                flex h-full items-center justify-center px-2
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
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        {panel === 'select'
          ? (
              <SelectModel
                value={value}
                onChange={(nextModel) => {
                  onChange?.(nextModel)
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
