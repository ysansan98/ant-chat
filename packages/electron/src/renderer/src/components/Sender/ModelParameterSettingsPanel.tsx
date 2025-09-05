import type { ServiceProviderModelsSchema } from '@ant-chat/shared'
import { Input, Slider } from 'antd'
import { useEffect, useState } from 'react'
import { dbApi } from '@/api/dbApi'
import PromptIcon from '@/assets/icons/prompt.svg?react'
import ReturnIcon from '@/assets/icons/return.svg?react'
import TemperatureIcon from '@/assets/icons/temperature.svg?react'
import { useChatSettingsContext } from '@/contexts/chatSettings'

export function ModelParameterSettingsPanel() {
  const { settings, updateSettings } = useChatSettingsContext()

  const [modelInfo, setModelInfo] = useState<ServiceProviderModelsSchema | null>(null)

  useEffect(() => {
    const fetchModelInfo = async () => {
      const info = await dbApi.getModelInfoById(settings.modelId)
      setModelInfo(info)
    }
    fetchModelInfo()
  }, [settings.modelId])

  return (
    <div className="w-80 p-2 px-4">
      <div className="mb-2 text-sm text-gray-500">
        模型设置
      </div>
      <div className="">
        <FormItem label="系统提示词" icon={<PromptIcon />}>
          <Input.TextArea value={settings.systemPrompt} onChange={e => updateSettings({ systemPrompt: e.target.value })} />
        </FormItem>
        <FormItem label="temperature" icon={<TemperatureIcon />}>
          <CustomSlider
            min={0}
            max={2}
            step={0.1}
            value={settings.temperature}
            onChange={value => updateSettings({ temperature: value })}
          />
        </FormItem>
        <FormItem label="maxTokens" icon={<ReturnIcon />}>
          <CustomSlider
            defaultValue={modelInfo?.maxTokens ?? 4096}
            min={1000}
            max={modelInfo?.maxTokens ?? 8000}
            formatter={value => `${Math.floor((value ?? 0) / 1000)}k`}
            step={1000}
            value={settings.maxTokens}
            onChange={value => updateSettings({ maxTokens: value })}
          />
        </FormItem>
      </div>
    </div>
  )
}

export function FormItem({ icon, label, children }: { icon?: React.ReactNode, label: string, children?: React.ReactNode }) {
  return (
    <div className="py-2">
      <div className="flex items-center gap-1 py-1 text-sm">
        {icon}
        {label}
      </div>
      <div className="">
        {children}
      </div>
    </div>
  )
}

interface CustomSliderProps {
  defaultValue?: number
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  formatter?: (value: number) => string
}

export function CustomSlider({ defaultValue, min, max, step, value, onChange, formatter }: CustomSliderProps) {
  return (
    <div className="relative">
      <div className="absolute top-0 right-0 translate-y-[-100%] text-xs">
        {formatter ? formatter(value) : value}
      </div>
      <Slider
        defaultValue={defaultValue}
        min={min}
        max={max}
        step={step}
        value={value}
        tooltip={{ open: false }}
        onChange={onChange}
      />
    </div>
  )
}
