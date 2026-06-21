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
            onValueChange={([v]) => updateSettings({ temperature: v })}
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
            onValueChange={([v]) => updateSettings({ maxTokens: v })}
          />
        </div>
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
            onValueChange={([v]) => updateCompaction({ thresholdPercent: v })}
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
            onValueChange={([v]) => updateCompaction({ keepRecentTokens: v })}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            This is a target. The actual retained context may be slightly larger to keep complete messages and tool calls intact.
          </p>
        </div>
      </div>
    </div>
  )
}
