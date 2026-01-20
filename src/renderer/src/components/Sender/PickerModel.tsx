import type { AllAvailableModelsSchema } from '@ant-chat/shared'
import { ControlOutlined, RightOutlined } from '@ant-design/icons'
import { useRequest } from 'ahooks'
import { Popover } from 'antd'
import React from 'react'
import { dbApi } from '@/api/dbApi'
import { ModelParameterSettingsPanel } from './ModelParameterSettingsPanel'
import { renderProviderLogo, SelectModel } from './SelectModel'

interface ModelControlPanelProps {
  value: string
  onChange?: (modelInfo: AllAvailableModelsSchema['models'][number]) => void
}

export function ModelControlPanel({ value, onChange }: ModelControlPanelProps) {
  const [openPopover, setOpenPopover] = React.useState(false)
  const [panel, setPanel] = React.useState<'select' | 'parameter'>('select')
  const { data } = useRequest<AllAvailableModelsSchema[], []>(dbApi.getAllAbvailableModels)

  const activeProviderServiceInfo = !value ? data?.[0] : data?.find(item => item.models.some(model => model.id === value))
  const currentModelInfo = activeProviderServiceInfo?.models.find(model => model.id === value)

  React.useEffect(() => {
    if (!value && activeProviderServiceInfo?.models.length) {
      onChange?.(activeProviderServiceInfo?.models[0])
    }
  })

  return (
    <Popover
      open={openPopover}
      arrow={false}
      placement="bottomLeft"
      trigger="click"
      destroyOnHidden={true}
      styles={{
        content: {
          padding: 0,
        },
      }}
      content={(
        panel === 'select'
          ? (
              <SelectModel
                value={value}
                onChange={(e) => {
                  onChange?.(e)
                  setOpenPopover(false)
                }}
                options={data}
              />
            )
          : (<ModelParameterSettingsPanel />)
      )}
      onOpenChange={(value) => {
        setOpenPopover(value)
        if (!value && panel === 'parameter') {
          setPanel('select')
        }
      }}
    >
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
          {renderProviderLogo(activeProviderServiceInfo?.id || '')}
          <div className="flex max-w-30 items-center truncate text-xs font-medium">
            <span className="truncate">{currentModelInfo?.name}</span>
            <RightOutlined className="px-2" />
          </div>
        </div>
        <div className="flex items-center justify-center overflow-hidden">
          <ControlOutlined
            className={`
              h-full px-2
              hover:bg-(--hover-bg-color)
            `}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setPanel('parameter')
              setTimeout(() => {
                setOpenPopover(true)
              }, 100)
            }}
          />
        </div>
      </div>
    </Popover>
  )
}
