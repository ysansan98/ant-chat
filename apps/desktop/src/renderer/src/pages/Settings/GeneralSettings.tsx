import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Globe, Info, Link } from 'lucide-react'
import React from 'react'
import AssistantIcon from '@/assets/icons/Assistant.svg?react'
import { CustomProxyUrl, ProxySettings } from '@/components/GeneralSettings/ProxySettings'
import { SelectModel } from '@/components/GeneralSettings/SelectModel'
import { useGeneralSettingsStore } from '@/store/generalSettings/store'

export function GeneralSettings() {
  const proxySettings = useGeneralSettingsStore(state => state.proxySettings)

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex flex-col gap-2">
        <GeneralSettingsItem
          title="助手模型"
          help="用于生成对话标题的模型，不设置将使用对话时选择的模型"
          icon={<AssistantIcon className="size-4" />}
        >
          <SelectModel />
        </GeneralSettingsItem>

        <GeneralSettingsItem
          title="网络代理"
          help="配置AI请求的代理设置，支持系统代理和自定义代理"
          icon={<Globe className="size-4" />}
        >
          <ProxySettings />
        </GeneralSettingsItem>

        {proxySettings.mode === 'custom' && (
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
      <span className="flex items-center gap-2 text-sm">
        {icon}
        {title}
        {
          help
            ? (
                <Tooltip>
                  <TooltipTrigger type="button">
                    <Info className="size-4 text-gray-500" />
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
