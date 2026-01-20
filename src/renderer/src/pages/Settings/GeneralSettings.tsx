import { GlobalOutlined, InfoCircleOutlined, LinkOutlined } from '@ant-design/icons'
import { Tooltip } from 'antd'
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
          icon={<AssistantIcon className="text-xl" />}
        >
          <SelectModel />
        </GeneralSettingsItem>

        <GeneralSettingsItem
          title="代理模式"
          help="配置AI请求的代理设置，支持系统代理和自定义代理"
          icon={<GlobalOutlined className="text-xl" />}
        >
          <ProxySettings />
        </GeneralSettingsItem>

        {proxySettings.mode === 'custom' && (
          <GeneralSettingsItem
            title="代理地址"
            help="配置自定义代理服务器地址"
            icon={<LinkOutlined className="text-xl" />}
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
      <span className="flex items-center gap-2 text-base">
        {icon}
        {title}
        {
          help
            ? (
                <Tooltip title={help}>
                  <InfoCircleOutlined className="text-xs text-gray-500" />
                </Tooltip>
              )
            : null
        }
      </span>
      {children}
    </div>
  )
}
