import type { ServiceProviderSchema } from '@ant-chat/shared'
import { useRequest } from 'ahooks'
import { Button, Empty, message, Switch } from 'antd'
import React from 'react'
import Logo from '@/../public/logo.svg?react'
import { providerApi } from '@/api/providerApi'
import { ProviderLogo } from '@/components/Chat/providerLogo'
import { AddCustomProvider } from '@/components/ProviderManage/AddCustomProvider'
import { ProviderServiceSettings } from '@/components/ProviderManage/ProviderServiceSettings'

export default function ProviderManage() {
  const [activeProvider, setActiveProvider] = React.useState<ServiceProviderSchema | null>(null)
  const { data, error, refresh, loading } = useRequest(providerApi.getAllProviderServices)

  const handleAddProvider = async (provider: Parameters<typeof providerApi.addProviderService>[0]) => {
    await providerApi.addProviderService(provider)
    refresh()
  }

  if (error) {
    return (
      <Empty description={error.message}>
        <Button type="text" onClick={() => refresh()}> 重试 </Button>
      </Empty>
    )
  }

  return (
    <div className="flex h-full">
      <div
        className={`
          flex h-dvh w-50 shrink-0 flex-col gap-2 overflow-y-auto border-r border-solid
          border-(--border-color) p-2
        `}
      >
        {
          data?.map(item => (
            <div
              key={item.id}
              className={`
                ${activeProvider?.id === item.id ? 'bg-(--hover-bg-color)' : ''}
                group flex cursor-pointer items-center justify-between gap-2 rounded-md p-2 px-3
                select-none
                hover:bg-(--hover-bg-color)
              `}
              onClick={() => {
                setActiveProvider(item)
              }}
            >
              <div className="flex items-center gap-2 text-base">
                <div className="
                  flex size-6 shrink-0 items-center justify-center rounded-sm bg-white
                "
                >
                  {(() => {
                    const content = (
                      <ProviderLogo id={item.id} name={item.name} size={16} className="size-4" />
                    )
                    return content || <Logo />
                  })()}
                </div>

                <span className="text-sm font-medium">
                  {item.name}
                </span>
              </div>
              <Switch
                value={item.isEnabled}
                onChange={async (e) => {
                  await providerApi.updateProviderService({ id: item.id, isEnabled: e })
                  refresh()
                }}
                size="small"
                className={`
                  hidden
                  group-hover:block
                `}
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
              <ProviderServiceSettings
                key={activeProvider?.id || ''}
                item={activeProvider}
                onChange={async (e) => {
                  await providerApi.updateProviderService(e)
                  refresh()
                }}
                onDelete={async () => {
                  try {
                    await providerApi.deleteProviderService(activeProvider.id)
                  }
                  catch (e) {
                    message.error((e as Error).message)
                    return
                  }

                  setActiveProvider(null)
                  refresh()
                }}
              />
            )
          : null
      }
    </div>
  )
}
