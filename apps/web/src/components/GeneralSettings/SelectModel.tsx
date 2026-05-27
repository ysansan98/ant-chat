import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { useAllAvailableModels } from '@/hooks/useAllAvailableModels'
import { setAssistantModelId, useGeneralSettingsStore } from '@/store/generalSettings'

export function SelectModel() {
  const { data: providers } = useAllAvailableModels()

  const assistantModelId = useGeneralSettingsStore(state => state.assistantModelId)

  return (
    <Select value={assistantModelId || '__default__'} onValueChange={value => setAssistantModelId(value === '__default__' ? '' : value)}>
      <SelectTrigger className="min-w-50">
        <SelectValue placeholder="选择模型" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__default__">使用默认模型</SelectItem>
        {providers?.map(item => (
          <SelectGroup key={item.name}>
            <SelectLabel>{item.name}</SelectLabel>
            {item.models.map(model => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
