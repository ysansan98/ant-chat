import type { ServiceProviderSchema } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Switch } from '@workspace/ui/components/switch'
import { useRequest } from 'ahooks'
import React from 'react'
import { toast } from 'sonner'
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
      <EmptyState title={error.message}>
        <Button variant="ghost" size="sm" onClick={() => refresh()}>重试</Button>
      </EmptyState>
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
                  await providerApi.updateProviderService({ id: item.id, isEnabled: e })
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
                    toast.error((e as Error).message)
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
