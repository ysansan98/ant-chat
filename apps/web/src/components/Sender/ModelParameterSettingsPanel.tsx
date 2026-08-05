import type { CompactionSettingsSchema, ProviderConfigModelSchema } from '@ant-chat/shared'
import { DEFAULT_COMPACTION_SETTINGS } from '@ant-chat/shared'
import { Label } from '@workspace/ui/components/label'
import { Separator } from '@workspace/ui/components/separator'
import { Slider } from '@workspace/ui/components/slider'
import { Switch } from '@workspace/ui/components/switch'
import { Textarea } from '@workspace/ui/components/textarea'
import { useEffect, useState } from 'react'
import { providerApi } from '@/api/providerApi'
import { useChatSettingsContext } from '@/contexts/chatSettings'

export function ModelParameterSettingsPanel() {
  const {
    settings,
    conversationInstructions,
    setConversationInstructions,
    updateSettings,
    updateConversationInstructions,
  } = useChatSettingsContext()
  const compaction = settings.compaction || DEFAULT_COMPACTION_SETTINGS

  const [modelInfo, setModelInfo] = useState<ProviderConfigModelSchema | null>(null)

  useEffect(() => {
    const fetchModelInfo = async () => {
      if (!settings.modelId || !settings.providerId) {
        setModelInfo(null)
        return
      }
      const info = await providerApi.getModelInfoById(settings.modelId, settings.providerId)
      setModelInfo(info)
    }
    fetchModelInfo()
  }, [settings.modelId, settings.providerId])

  function updateCompaction(partial: Partial<CompactionSettingsSchema>) {
    updateSettings({ compaction: { ...compaction, ...partial } })
  }

  function getSliderValue(value: number | readonly number[]) {
    return typeof value === 'number' ? value : value[0]
  }

  return (
    <div className="w-80 p-2 px-4">
      <h4 className="mb-3 text-sm font-medium text-muted-foreground">会话指令</h4>

      <Textarea
        aria-label="会话指令"
        id="conversation-instructions"
        placeholder="例如：使用中文回答，优先给出可执行结论"
        value={conversationInstructions}
        onChange={event => setConversationInstructions(event.target.value)}
        onBlur={event => void updateConversationInstructions(event.currentTarget.value)}
      />

      <Separator className="my-4" />

      <h4 className="mb-3 text-sm font-medium text-muted-foreground">上下文压缩</h4>

      <p className="mb-3 text-xs/relaxed text-muted-foreground">
        未单独设置时使用默认自动压缩策略。
      </p>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="compaction-enabled">启用自动压缩</Label>
          <Switch
            id="compaction-enabled"
            size="sm"
            checked={compaction.enabled}
            onCheckedChange={checked => updateCompaction({ enabled: checked })}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="compaction-threshold">触发阈值</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {compaction.thresholdPercent}
              %
            </span>
          </div>
          <Slider
            id="compaction-threshold"
            min={10}
            max={90}
            step={10}
            value={[compaction.thresholdPercent]}
            onValueChange={value => updateCompaction({ thresholdPercent: getSliderValue(value) })}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="compaction-retained-tokens">保留目标</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {`${Math.round(compaction.keepRecentTokens / 1000)}k Token`}
            </span>
          </div>
          <Slider
            id="compaction-retained-tokens"
            min={1000}
            max={Math.max(compaction.keepRecentTokens, modelInfo?.contextLength ?? 100_000)}
            step={1000}
            value={[compaction.keepRecentTokens]}
            onValueChange={value => updateCompaction({ keepRecentTokens: getSliderValue(value) })}
          />
          <p className="text-xs/relaxed text-muted-foreground">
            这是目标值。为保持消息和工具调用完整，实际保留的上下文可能略多。
          </p>
        </div>
      </div>
    </div>
  )
}
