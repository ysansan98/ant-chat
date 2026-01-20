import type { ServiceProviderSchema } from '@ant-chat/shared'
import { useRequest } from 'ahooks'
import { Button, Empty, message, Switch } from 'antd'
import React from 'react'
import Logo from '@/../public/logo.svg?react'
import { dbApi } from '@/api/dbApi'
import { getProviderLogo } from '@/components/Chat/providerLogo'
import { AddCustomProvider } from '@/components/ProviderManage/AddCustomProvider'
import { ProviderServiceSettings } from '@/components/ProviderManage/ProviderServiceSettings'

export default function ProviderManage() {
  const [activeProvider, setActiveProvider] = React.useState<ServiceProviderSchema | null>(null)
  const { data, error, refresh, loading } = useRequest(dbApi.getAllProviderServices)

  const handleAddProvider = async (provider: Parameters<typeof dbApi.AddServiceProvider>[0]) => {
    await dbApi.AddServiceProvider(provider)
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
          border-(--border-color) px-2 py-2
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
                <div className="rounded bg-white p-1">
                  {(() => {
                    const Icon = getProviderLogo(item.id)
                    return Icon ? <Icon /> : <Logo />
                  })()}
                </div>

                <span className="text-sm font-medium">
                  {item.name}
                </span>
              </div>
              <Switch
                value={item.isEnabled}
                onChange={async (e) => {
                  await dbApi.updateServiceProvider({ id: item.id, isEnabled: e })
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
          <AddCustomProvider onAdd={handleAddProvider} loading={loading} />
        </div>
      </div>
      {
        activeProvider
          ? (
              <ProviderServiceSettings
                key={activeProvider?.id || ''}
                item={activeProvider}
                onChange={async (e) => {
                  await dbApi.updateServiceProvider(e)
                  refresh()
                }}
                onDelete={async () => {
                  try {
                    await dbApi.deleteServiceProvider(activeProvider.id)
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
