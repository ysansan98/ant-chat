import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { useAllAvailableModels } from '@/hooks/useAllAvailableModels'
import { setAssistantModel, useGeneralSettingsStore } from '@/store/generalSettings'

export function SelectModel() {
  const { data: providers } = useAllAvailableModels()

  const assistantModelId = useGeneralSettingsStore(state => state.assistantModelId)
  const assistantProviderId = useGeneralSettingsStore(state => state.assistantProviderId)

  const currentValue = assistantModelId ? `${assistantProviderId}|${assistantModelId}` : '__default__'
  const items = [
    { label: '使用默认模型', value: '__default__' },
    ...(providers?.flatMap(provider => provider.models.map(model => ({
      label: model.name,
      value: `${provider.id}|${model.id}`,
    }))) ?? []),
  ]

  return (
    <Select
      items={items}
      value={currentValue}
      onValueChange={(value) => {
        if (!value) {
          return
        }
        if (value === '__default__') {
          setAssistantModel('', '')
        }
        else {
          const [providerId, modelId] = value.split('|')
          setAssistantModel(modelId, providerId)
        }
      }}
    >
      <SelectTrigger className="min-w-50">
        <SelectValue placeholder="选择模型" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__default__">使用默认模型</SelectItem>
        {providers?.map(item => (
          <SelectGroup key={item.name}>
            <SelectLabel>{item.name}</SelectLabel>
            {item.models.map(model => (
              <SelectItem key={`${item.id}|${model.id}`} value={`${item.id}|${model.id}`}>
                {model.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
