import type { ProviderConfigSchema } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Switch } from '@workspace/ui/components/switch'
import { useRequest } from 'ahooks'
import { ArrowLeft } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { providerApi } from '@/api/providerApi'
import { ProviderLogo } from '@/components/Chat/providerLogo'
import { AddCustomProvider } from '@/components/ProviderManage/AddCustomProvider'
import { ProviderSettingsPanel } from '@/components/ProviderManage/ProviderSettingsPanel'

export default function ProviderManage() {
  const [activeProvider, setActiveProvider] = React.useState<ProviderConfigSchema | null>(null)
  const [mobileShowDetail, setMobileShowDetail] = React.useState(false)
  const { data, error, refresh, loading } = useRequest(providerApi.listProviders)

  const handleAddProvider = async (provider: Parameters<typeof providerApi.createProvider>[0]) => {
    await providerApi.createProvider(provider)
    refresh()
  }

  function handleSelectProvider(item: ProviderConfigSchema) {
    setActiveProvider(item)
    setMobileShowDetail(true)
  }

  function handleBack() {
    setMobileShowDetail(false)
  }

  if (error) {
    return (
      <EmptyState title={error.message}>
        <Button variant="ghost" size="sm" onClick={() => refresh()}>重试</Button>
      </EmptyState>
    )
  }

  // Provider list panel (shared between mobile and desktop)
  const listPanel = (
    <div
      className={`
        flex h-full w-full shrink-0 flex-col gap-2 overflow-y-auto border-r border-solid
        border-(--border-color) p-2
        md:w-50
        ${mobileShowDetail ? 'hidden md:flex' : 'flex'}
      `}
    >
      {data?.map(item => (
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
          onClick={() => handleSelectProvider(item)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleSelectProvider(item)
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
          <div
            role="button"
            tabIndex={0}
            onClick={e => e.stopPropagation()}
          >
            <Switch
              checked={item.isEnabled}
              onCheckedChange={async (e) => {
                await providerApi.updateProvider({ id: item.id, isEnabled: e })
                refresh()
              }}
              size="sm"
            />
          </div>
        </div>
      ))}
      <div className="p-2">
        <AddCustomProvider
          onAdd={handleAddProvider}
          existingProviderIds={data?.map(item => item.id)}
          loading={loading}
        />
      </div>
    </div>
  )

  // Detail panel (shared between mobile and desktop)
  const detailPanel = activeProvider
    ? (
        <div className={`min-w-0 flex-1 ${mobileShowDetail ? 'flex flex-col' : 'hidden md:flex md:flex-col'}`}>
          {/* Mobile back header */}
          <div className="flex items-center gap-2 border-b border-(--border-color) px-3 py-2 md:hidden">
            <button
              type="button"
              className="flex items-center gap-1 text-sm text-primary hover:opacity-70"
              onClick={handleBack}
            >
              <ArrowLeft className="size-4" />
              返回列表
            </button>
            <span className="truncate text-sm font-medium">
              {activeProvider.name}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ProviderSettingsPanel
              key={activeProvider.id}
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
                setMobileShowDetail(false)
                refresh()
              }}
            />
          </div>
        </div>
      )
    : null

  return (
    <div className="flex h-full flex-col md:flex-row">
      {listPanel}
      {detailPanel}
    </div>
  )
}
