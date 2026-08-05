import type { ProxySettings } from '@ant-chat/shared'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import { Switch } from '@workspace/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Info } from 'lucide-react'
import { toast } from 'sonner'
import { observabilityApi } from '@/api/observabilityApi'
import { CustomProxyUrl, ProxySettings as ProxySettingsControl } from '@/components/GeneralSettings/ProxySettings'
import { SelectModel } from '@/components/GeneralSettings/SelectModel'
import { setAgentObservabilityEnabled, setAutoGenerateTitle, updateProxySettings, useGeneralSettingsStore } from '@/store/generalSettings'
import { BrowserProfilesSettings } from './BrowserProfiles'
import { SettingsPageLayout } from './SettingsPageLayout'

export function GeneralSettings() {
  const proxySettings = useGeneralSettingsStore(state => state.proxySettings)
  const autoGenerateTitle = useGeneralSettingsStore(state => state.autoGenerateTitle)
  const observabilityEnabled = useGeneralSettingsStore(state => state.developerTools.agentObservabilityEnabled)

  const handleProxyModeChange = async (mode: ProxySettings['mode']) => {
    await updateProxySettings({ mode })
  }

  const showCustomUrl = proxySettings.mode === 'custom'

  return (
    <SettingsPageLayout
      title="通用设置"
      description="设置助手模型、开发者工具、网络连接与浏览器 Cookies。"
      variant="narrow"
    >
      <div className="flex flex-col gap-6">
        {/* 对话 */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">对话</h3>
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

        <section>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">开发者工具</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <GeneralSettingsRow
              title="Agent Observability"
              help="记录每个 Agent Turn 的模型请求、策略判断、工具调用与上下文事件；设置从下一个 Turn 开始生效"
            >
              <Switch
                checked={observabilityEnabled}
                onCheckedChange={enabled => void setAgentObservabilityEnabled(enabled)}
                aria-label="启用 Agent Observability"
              />
            </GeneralSettingsRow>
            <GeneralSettingsRow
              title="清除全部 Trace"
              help="永久删除本机已采集的所有 Agent 执行轨迹"
            >
              <AlertDialog>
                <AlertDialogTrigger render={<Button type="button" variant="destructive" size="sm">清除全部</Button>} />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>清除全部 Trace？</AlertDialogTitle>
                    <AlertDialogDescription>所有会话的 Agent 执行轨迹都会从本机永久删除，此操作无法撤销。</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => void observabilityApi.clearAll().then(() => toast.success('全部 Trace 已清除')).catch(error => toast.error(error instanceof Error ? error.message : '清除 Trace 失败'))}
                    >
                      确认清除
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </GeneralSettingsRow>
          </div>
        </section>

        {/* 网络 */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">网络</h3>
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

        {/* 浏览器 */}
        <section>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">浏览器</h3>
          <BrowserProfilesSettings />
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
