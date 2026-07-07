import type { ProxySettings as ProxySettingsType } from '@ant-chat/shared'
import { Switch } from '@workspace/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Globe, Info, Link, Sparkles } from 'lucide-react'
import React from 'react'
import AssistantIcon from '@/assets/icons/assistant.svg?react'
import { CustomProxyUrl, ProxySettings } from '@/components/GeneralSettings/ProxySettings'
import { SelectModel } from '@/components/GeneralSettings/SelectModel'
import { setAutoGenerateTitle, updateProxySettings, useGeneralSettingsStore } from '@/store/generalSettings'
import { SettingsPageHeader } from './SettingsPageHeader'

export function GeneralSettings() {
  const proxySettings = useGeneralSettingsStore(state => state.proxySettings)
  const autoGenerateTitle = useGeneralSettingsStore(state => state.autoGenerateTitle)
  const [draftProxyMode, setDraftProxyMode] = React.useState<ProxySettingsType['mode']>(proxySettings.mode)

  React.useEffect(() => {
    setDraftProxyMode(proxySettings.mode)
  }, [proxySettings.mode])

  const handleProxyModeChange = async (mode: ProxySettingsType['mode']) => {
    if (mode === 'custom') {
      setDraftProxyMode('custom')
      return
    }

    try {
      await updateProxySettings({ mode })
    }
    catch {
      setDraftProxyMode(proxySettings.mode)
    }
  }

  const showCustomUrl = draftProxyMode === 'custom'

  return (
    <div className="flex flex-col gap-4 p-4">
      <SettingsPageHeader
        title="通用设置"
        description="设置助手模型与网络连接方式。"
      />
      <div className="flex flex-col gap-2">
        <GeneralSettingsItem
          title="自动生成标题"
          help="开启后使用 AI 模型自动生成对话标题，关闭时将使用首条消息的前 30 个字符作为标题"
          icon={<Sparkles className="size-4" />}
        >
          <Switch
            checked={autoGenerateTitle}
            onCheckedChange={setAutoGenerateTitle}
          />
        </GeneralSettingsItem>

        {autoGenerateTitle && (
          <GeneralSettingsItem
            title="标题生成模型"
            help="用于生成对话标题的模型，不设置将使用对话时选择的模型"
            icon={<AssistantIcon className="size-4" />}
          >
            <SelectModel />
          </GeneralSettingsItem>
        )}

        <GeneralSettingsItem
          title="网络代理"
          help="配置AI请求的代理设置，支持系统代理和自定义代理"
          icon={<Globe className="size-4" />}
        >
          <ProxySettings draftMode={draftProxyMode} onModeChange={handleProxyModeChange} />
        </GeneralSettingsItem>

        {showCustomUrl && (
          <GeneralSettingsItem
            title="代理地址"
            help="配置自定义代理服务器地址"
            icon={<Link className="size-4" />}
          >
            <CustomProxyUrl />
          </GeneralSettingsItem>
        )}
      </div>
    </div>
  )
}

interface GeneralSettingsItemProps {
  title: string
  help?: string
  icon?: React.ReactNode
  children?: React.ReactNode
}

function GeneralSettingsItem({ title, help, icon, children }: GeneralSettingsItemProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-1">
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
        {
          help
            ? (
                <Tooltip>
                  <TooltipTrigger type="button">
                    <Info className="size-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>{help}</p>
                  </TooltipContent>
                </Tooltip>
              )
            : null
        }
      </span>
      {children}
    </div>
  )
}
