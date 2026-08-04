import type { ProviderPublicView } from '@ant-chat/shared'
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
import { SettingsPageLayout } from './SettingsPageLayout'

const PROVIDER_LIST_WIDTH_KEY = 'ant-chat.provider-list-width'
const DEFAULT_PROVIDER_LIST_WIDTH = 200
const MIN_PROVIDER_LIST_WIDTH = 160
const MAX_PROVIDER_LIST_WIDTH = 400

export default function ProviderManage() {
  const [activeProviderId, setActiveProviderId] = React.useState<string | null>(null)
  const [listWidth, setListWidth] = React.useState<number>(() => {
    if (typeof window === 'undefined')
      return DEFAULT_PROVIDER_LIST_WIDTH
    const raw = window.localStorage.getItem(PROVIDER_LIST_WIDTH_KEY)
    if (raw == null)
      return DEFAULT_PROVIDER_LIST_WIDTH
    const stored = Number(raw)
    if (!Number.isFinite(stored))
      return DEFAULT_PROVIDER_LIST_WIDTH
    return Math.max(MIN_PROVIDER_LIST_WIDTH, Math.min(MAX_PROVIDER_LIST_WIDTH, stored))
  })
  const { data, error, refresh, loading } = useRequest(providerApi.listProviders)
  const activeProvider: ProviderPublicView | null = data?.find(item => item.id === activeProviderId) ?? null

  React.useEffect(() => {
    if (typeof window !== 'undefined')
      window.localStorage.setItem(PROVIDER_LIST_WIDTH_KEY, String(listWidth))
  }, [listWidth])

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
      <SettingsPageLayout
        title="AI 服务商设置"
        description="配置服务商凭证、接口地址与可用模型。"
        variant="wide"
      >
        <EmptyState title={error.message}>
          <Button variant="ghost" size="sm" onClick={() => refresh()}>重试</Button>
        </EmptyState>
      </SettingsPageLayout>
    )
  }

  return (
    <SettingsPageLayout
      title="AI 服务商设置"
      description="配置服务商凭证、接口地址与可用模型。"
      variant="wide"
    >
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-card/40">
        <div
          className="relative h-full shrink-0 border-r border-border/70"
          style={{ width: listWidth }}
        >
          <ResizeHandle width={listWidth} onWidthChange={setListWidth} />
          <div className="flex h-full flex-col gap-2 overflow-y-auto p-2">
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
                    setActiveProviderId(item.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setActiveProviderId(item.id)
                    }
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2">
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

                    <span className="min-w-0 truncate text-sm font-medium">
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

                    setActiveProviderId(null)
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
    </SettingsPageLayout>
  )
}

function ResizeHandle({ width, onWidthChange }: { width: number, onWidthChange: (width: number) => void }) {
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const startX = event.clientX
    const startWidth = width
    const move = (next: PointerEvent) => onWidthChange(Math.max(MIN_PROVIDER_LIST_WIDTH, Math.min(MAX_PROVIDER_LIST_WIDTH, startWidth + (next.clientX - startX))))
    const finish = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', finish)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', finish)
  }
  return <div className="absolute inset-y-0 -right-1 z-10 w-2 cursor-ew-resize hover:bg-primary/20" onPointerDown={handlePointerDown} />
}
