import type { AllAvailableModelsSchema } from '@ant-chat/shared'
import { CheckOutlined } from '@ant-design/icons'
import { Input } from 'antd'
import React from 'react'
import { getProviderLogo } from '../Chat/providerLogo'

export interface SelectModelProps {
  value: string
  onChange?: (value: AllAvailableModelsSchema['models'][number]) => void
  options?: AllAvailableModelsSchema[]
}

export function SelectModel({ value, onChange, options }: SelectModelProps) {
  const [keyword, setKeyword] = React.useState('')

  return (
    <div>
      <div className="p-2 pt-2">
        <Input
          size="small"
          placeholder="搜索模型"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
      </div>

      <div className="mt-1 max-h-38 overflow-y-auto px-2">
        {
          options?.length
            ? (
                options.map(item => (
                  <div key={item.id}>
                    <div className="mt-1 text-xs text-gray-500">{item.name}</div>
                    <div>
                      {item.models.filter(model => model.name.includes(keyword)).map(model => (
                        <div
                          key={model.id}
                          className={`
                            flex cursor-pointer items-center justify-between rounded-md p-2 text-xs
                            hover:bg-(--hover-bg-color)
                          `}
                          onClick={() => {
                            onChange?.(model)
                            setKeyword('')
                          }}
                        >
                          <div className="flex items-center gap-1">
                            {renderProviderLogo(item.id)}
                            <span className="font-medium">
                              {model.name}
                            </span>
                          </div>
                          <div>
                            {value === model.id ? (<CheckOutlined />) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="h-1"></div>
                  </div>
                ))
              )
            : (
                <div className="p-2 text-center text-xs">
                  暂无模型，请先启用AI服务商
                </div>
              )
        }
      </div>

    </div>
  )
}

export function renderProviderLogo(providerServiceId: string) {
  const Logo = getProviderLogo(providerServiceId)

  if (!Logo)
    return null

  return <span className="rounded-md bg-white p-1"><Logo /></span>
}
