import type { CompactionSettingsSchema, ProviderConfigModelSchema, ReasoningEffortLevel } from '@ant-chat/shared'
import { DEFAULT_COMPACTION_SETTINGS } from '@ant-chat/shared'
import { Label } from '@workspace/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Separator } from '@workspace/ui/components/separator'
import { Slider } from '@workspace/ui/components/slider'
import { Switch } from '@workspace/ui/components/switch'
import { Textarea } from '@workspace/ui/components/textarea'
import { useEffect, useState } from 'react'
import { providerApi } from '@/api/providerApi'
import { useChatSettingsContext } from '@/contexts/chatSettings'

export function ModelParameterSettingsPanel() {
  const { settings, updateSettings } = useChatSettingsContext()
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

  // 推理强度档位的中文展示；模型能力未声明时为空（不渲染控件）
  const REASONING_EFFORT_LABELS: Record<ReasoningEffortLevel, string> = {
    'provider-default': '厂商默认',
    'none': '关闭',
    'minimal': '极简',
    'low': '低',
    'medium': '中',
    'high': '高',
    'xhigh': '极高',
  }
  const reasoningLevels = modelInfo?.capabilities?.reasoningLevels
  const reasoningOptions = (reasoningLevels && reasoningLevels.length > 0)
    ? (['provider-default', ...reasoningLevels] as ReasoningEffortLevel[])
    : null
  // 当前选择需在可选范围内，否则回退到「厂商默认」
  const currentEffort = (reasoningOptions && settings.reasoningEffort && reasoningOptions.includes(settings.reasoningEffort))
    ? settings.reasoningEffort
    : 'provider-default'

  return (
    <div className="w-80 p-2 px-4">
      <h4 className="mb-3 text-sm font-medium text-muted-foreground">模型设置</h4>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="system-prompt">系统提示词</Label>
          <Textarea
            id="system-prompt"
            value={settings.systemPrompt}
            onChange={e => updateSettings({ systemPrompt: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="temperature">Temperature</Label>
            <span className="text-xs text-muted-foreground tabular-nums">{settings.temperature}</span>
          </div>
          <Slider
            id="temperature"
            min={0}
            max={2}
            step={0.1}
            value={[settings.temperature]}
            onValueChange={value => updateSettings({ temperature: getSliderValue(value) })}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="max-tokens">Max Tokens</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {`${Math.floor((settings.maxTokens ?? 0) / 1000)}k`}
            </span>
          </div>
          <Slider
            id="max-tokens"
            min={1000}
            max={modelInfo?.maxTokens ?? 8000}
            step={1000}
            value={[settings.maxTokens]}
            onValueChange={value => updateSettings({ maxTokens: getSliderValue(value) })}
          />
        </div>

        {reasoningOptions && (
          <div className="space-y-1.5">
            <Label htmlFor="reasoning-effort">推理强度</Label>
            <Select
              value={currentEffort}
              onValueChange={value => updateSettings({ reasoningEffort: value as ReasoningEffortLevel })}
            >
              <SelectTrigger id="reasoning-effort" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="provider-default">{REASONING_EFFORT_LABELS['provider-default']}</SelectItem>
                {reasoningOptions.slice(1).map(level => (
                  <SelectItem key={level} value={level}>{REASONING_EFFORT_LABELS[level]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs/relaxed text-muted-foreground">
              仅当前模型支持配置推理强度时可用。
            </p>
          </div>
        )}
      </div>

      <Separator className="my-4" />

      <h4 className="mb-3 text-sm font-medium text-muted-foreground">Context compaction</h4>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="compaction-enabled">Enable compaction</Label>
          <Switch
            id="compaction-enabled"
            size="sm"
            checked={compaction.enabled}
            onCheckedChange={checked => updateCompaction({ enabled: checked })}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="compaction-threshold">Trigger threshold</Label>
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
            <Label htmlFor="compaction-retained-tokens">Retention target</Label>
            <span className="text-xs text-muted-foreground tabular-nums">
              {`${Math.round(compaction.keepRecentTokens / 1000)}k tokens`}
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
            This is a target. The actual retained context may be slightly larger to keep complete messages and tool calls intact.
          </p>
        </div>
      </div>
    </div>
  )
}
