import type { ProxySettings } from '@ant-chat/shared'
import { Switch } from '@workspace/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Info } from 'lucide-react'
import { CustomProxyUrl, ProxySettings as ProxySettingsControl } from '@/components/GeneralSettings/ProxySettings'
import { SelectModel } from '@/components/GeneralSettings/SelectModel'
import { setAutoGenerateTitle, updateProxySettings, useGeneralSettingsStore } from '@/store/generalSettings'
import { SettingsPageLayout } from './SettingsPageLayout'

export function GeneralSettings() {
  const proxySettings = useGeneralSettingsStore(state => state.proxySettings)
  const autoGenerateTitle = useGeneralSettingsStore(state => state.autoGenerateTitle)

  const handleProxyModeChange = async (mode: ProxySettings['mode']) => {
    await updateProxySettings({ mode })
  }

  const showCustomUrl = proxySettings.mode === 'custom'

  return (
    <SettingsPageLayout
      title="通用设置"
      description="设置助手模型与网络连接方式。"
      variant="narrow"
    >
      <div className="flex flex-col gap-6">
        {/* 对话 */}
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-muted-foreground">对话</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <GeneralSettingsRow
              title="自动生成标题"
              help="开启后使用 AI 模型自动生成对话标题，关闭时将使用首条消息的前 30 个字符作为标题"
            >
              <Switch
                checked={autoGenerateTitle}
                onCheckedChange={setAutoGenerateTitle}
              />
            </GeneralSettingsRow>

            {autoGenerateTitle && (
              <GeneralSettingsRow
                title="标题生成模型"
                help="用于生成对话标题的模型，不设置将使用对话时选择的模型"
              >
                <SelectModel />
              </GeneralSettingsRow>
            )}
          </div>
        </section>

        {/* 网络 */}
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-muted-foreground">网络</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <GeneralSettingsRow
              title="网络代理"
              help="配置AI请求的代理设置，支持系统代理和自定义代理"
            >
              <ProxySettingsControl onModeChange={handleProxyModeChange} />
            </GeneralSettingsRow>

            {showCustomUrl && (
              <GeneralSettingsRow
                title="代理地址"
                help="配置自定义代理服务器地址"
              >
                <CustomProxyUrl />
              </GeneralSettingsRow>
            )}
          </div>
        </section>
      </div>
    </SettingsPageLayout>
  )
}

interface GeneralSettingsRowProps {
  title: string
  help?: string
  children?: React.ReactNode
}

/** 分组容器内的设置行：左标签右控件，行间分割线 */
function GeneralSettingsRow({ title, help, children }: GeneralSettingsRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0">
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-medium">{title}</span>
        {help
          ? (
              <Tooltip>
                <TooltipTrigger type="button">
                  <Info className="size-3.5 shrink-0 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{help}</p>
                </TooltipContent>
              </Tooltip>
            )
          : null}
      </span>
      <span className="flex shrink-0 items-center">{children}</span>
    </div>
  )
}
