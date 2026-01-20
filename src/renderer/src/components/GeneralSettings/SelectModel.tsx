import { Select } from 'antd'
import React from 'react'
import { useAllAvailableModels } from '@/hooks/useAllAvailableModels'
import { setAssistantModelId, useGeneralSettingsStore } from '@/store/generalSettings'

export function SelectModel() {
  const { data: providers } = useAllAvailableModels()

  const assistantModelId = useGeneralSettingsStore(state => state.assistantModelId)

  const options = React.useMemo(() => providers?.map(item => ({
    label: item.name,
    title: item.name,
    options: item.models.map(model => ({
      label: model.name,
      value: model.id,
    })),
  })), [providers])

  return (
    <Select
      value={assistantModelId}
      options={[{ label: '使用默认模型', value: '' }, ...(options ?? [])]}
      className="min-w-50"
      onChange={value => setAssistantModelId(value)}
    />
  )
}
