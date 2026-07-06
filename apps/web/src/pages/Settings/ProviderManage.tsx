import type { ProviderConfigSchema } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Switch } from '@workspace/ui/components/switch'
import { useRequest } from 'ahooks'
import React from 'react'
import { toast } from 'sonner'
import { providerApi } from '@/api/providerApi'
import { ProviderLogo } from '@/components/Chat/providerLogo'
import { AddCustomProvider } from '@/components/ProviderManage/AddCustomProvider'
import { ProviderSettingsPanel } from '@/components/ProviderManage/ProviderSettingsPanel'
import { PROVIDER_CHANGED_EVENT } from '@/constants/providerEvents'
import { SettingsPageHeader } from './SettingsPageHeader'

export default function ProviderManage() {
  const [activeProvider, setActiveProvider] = React.useState<ProviderConfigSchema | null>(null)
  const { data, error, refresh, loading } = useRequest(providerApi.listProviders)

  React.useEffect(() => {
    window.addEventListener(PROVIDER_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(PROVIDER_CHANGED_EVENT, refresh)
  }, [refresh])

  const handleAddProvider = async (provider: Parameters<typeof providerApi.createProvider>[0]) => {
    await providerApi.createProvider(provider)
    refresh()
  }

  if (error) {
    return (
      <EmptyState title={error.message}>
        <Button variant="ghost" size="sm" onClick={() => refresh()}>重试</Button>
      </EmptyState>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <SettingsPageHeader
        title="AI 服务商设置"
        description="配置服务商凭证、接口地址与可用模型。"
      />
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-card/40">
        <div
          className="flex h-full w-50 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border/70 p-2"
        >
          {
            data?.map(item => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                className={`
                ${activeProvider?.id === item.id ? 'bg-(--hover-bg-color)' : ''}
                group flex cursor-pointer items-center justify-between gap-2 rounded-md p-2 px-3
                select-none
                hover:bg-(--hover-bg-color)
              `}
                onClick={() => {
                  setActiveProvider(item)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setActiveProvider(item)
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="
                  flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-white
                "
                  >
                    {(() => {
                      const content = (
                        <ProviderLogo id={item.id} name={item.name} size={14} className="size-3.5" />
                      )
                      return content || <img src="/logo.svg" alt="" className="size-3.5" draggable={false} />
                    })()}
                  </div>

                  <span className="text-sm font-medium">
                    {item.name}
                  </span>
                </div>
                <Switch
                  checked={item.isEnabled}
                  onCheckedChange={async (e) => {
                    await providerApi.updateProvider({ id: item.id, isEnabled: e })
                    refresh()
                  }}
                  size="sm"
                />
              </div>
            ))
          }
          <div className="p-2">
            <AddCustomProvider
              onAdd={handleAddProvider}
              existingProviderIds={data?.map(item => item.id)}
              loading={loading}
            />
          </div>
        </div>
        {
          activeProvider
            ? (
                <ProviderSettingsPanel
                  key={activeProvider?.id || ''}
                  item={activeProvider}
                  onChange={async (e) => {
                    await providerApi.updateProvider(e)
                    refresh()
                  }}
                  onDelete={async () => {
                    try {
                      await providerApi.deleteProvider(activeProvider.id)
                    }
                    catch (e) {
                      toast.error((e as Error).message)
                      return
                    }

                    setActiveProvider(null)
                    refresh()
                  }}
                />
              )
            : (
                <EmptyState
                  className="min-w-0 flex-1"
                  title="选择一个 AI 服务商"
                  description="选择左侧服务商后，可配置接口地址、密钥和模型。"
                />
              )
        }
      </div>
    </div>
  )
}
