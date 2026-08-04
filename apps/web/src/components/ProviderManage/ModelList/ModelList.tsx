import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { useRequest } from 'ahooks'
import { CheckCircle, MinusCircle, PlusCircle, RefreshCcw, Trash2 } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { providerApi } from '@/api/providerApi'
import { AddModelFormModal } from './AddModelForm'

export interface ModelListProps {
  providerId: string
}

export function ModelList({ providerId }: ModelListProps) {
  const [openAddModal, setOpenAddModal] = React.useState(false)
  const [isSyncing, setIsSyncing] = React.useState(false)
  const { data, error, refresh, run, mutate } = useRequest(
    providerApi.listProviderModels,
    {
      defaultParams: [providerId],
    },
  )

  React.useEffect(() => {
    run(providerId)
  }, [providerId, run])

  if (error) {
    return (
      <EmptyState title={error.message}>
        <Button size="sm" onClick={refresh}>重试</Button>
      </EmptyState>
    )
  }

  return (
    <div className="py-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            setOpenAddModal(true)
          }}
        >
          <PlusCircle className="size-4" />
          添加模型
        </Button>
        <Button
          size="sm"
          disabled={isSyncing}
          onClick={async () => {
            setIsSyncing(true)
            try {
              const result = await providerApi.syncModels(providerId)
              toast.success(`模型同步完成，当前共有 ${result.length} 个模型`)
              refresh()
            }
            catch (e) {
              toast.error((e as Error).message)
            }
            finally {
              setIsSyncing(false)
            }
          }}
        >
          <RefreshCcw className="size-4" />
          同步模型
        </Button>
      </div>
      <div className="mt-2 flex max-h-100 flex-col overflow-y-auto rounded-md border border-(--border-color)">
        {data?.map(item => (
          <div
            key={item.id}
            className={`
              flex items-center justify-between border-b border-(--border-color) px-3 py-2
              last:border-0
            `}
          >
            <div className="flex items-center gap-1 text-sm">{item.name}</div>

            <div className="flex items-center gap-2">
              {item.isBuiltin
                ? (
                    'default'
                  )
                : (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`删除 ${item.name}`}
                      onClick={async () => {
                        try {
                          await providerApi.deleteProviderModel(providerId, item.id)
                          toast.success('删除成功')
                        }
                        catch (e: unknown) {
                          toast.error(`删除失败: ${(e as Error).message}`)
                        }

                        refresh()
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${item.isEnabled ? '禁用' : '启用'} ${item.name}`}
                onClick={async () => {
                  await providerApi.setModelEnabledStatus(providerId, item.id, !item.isEnabled)
                  refresh()
                }}
              >
                {item.isEnabled
                  ? (
                      <CheckCircle className="size-4 text-emerald-700 dark:text-emerald-400" />
                    )
                  : (
                      <MinusCircle className="size-4 text-destructive" />
                    )}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <AddModelFormModal
        open={openAddModal}
        title="添加模型"
        onCancel={() => setOpenAddModal(false)}
        onClose={() => setOpenAddModal(false)}
        onSave={async (e) => {
          providerApi
            .createProviderModel({
              ...e,
              providerId,
            })
            .then(
              (modelInfo) => {
                setOpenAddModal(false)
                mutate([modelInfo, ...(data ?? [])])
              },
              (err: Error) => {
                toast.error(err.message)
              },
            )
        }}
      />
    </div>
  )
}
