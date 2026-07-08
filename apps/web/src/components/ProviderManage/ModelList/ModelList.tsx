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
  const [openAddModal, setAddModal] = React.useState(false)
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
            setAddModal(true)
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
              const result = await providerApi.importModelsDevModels(providerId)
              if (result.added.length === 0 && result.skipped.length === 0 && result.errors.length === 0) {
                toast.info('未发现可同步的模型')
              }
              if (result.added.length > 0) {
                toast.success(`已导入 ${result.added.length} 个模型`)
              }
              if (result.skipped.length > 0) {
                toast.warning(`已存在模型：${result.skipped.join('、')}`)
              }
              if (result.duplicates.length > 0) {
                toast.info(`已忽略重复条目：${result.duplicates.join('、')}`)
              }
              if (result.errors.length > 0) {
                const errorMessage = result.errors.map(item => `${item.model}（${item.reason}）`).join('、')
                toast.error(`导入失败：${errorMessage}`)
              }
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
          同步模型列表
        </Button>
      </div>
      <div className="mt-2 flex flex-col rounded-md border border-(--border-color)">
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
                      onClick={async () => {
                        try {
                          await providerApi.deleteProviderModel(item.id)
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
                onClick={async () => {
                  await providerApi.setModelEnabledStatus(item.id, !item.isEnabled)
                  refresh()
                }}
              >
                {item.isEnabled
                  ? (
                      <CheckCircle className="size-4 text-green-500" />
                    )
                  : (
                      <MinusCircle className="size-4 text-red-500" />
                    )}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <AddModelFormModal
        open={openAddModal}
        title="添加模型"
        onCancel={() => setAddModal(false)}
        onClose={() => setAddModal(false)}
        onSave={async (e) => {
          providerApi
            .createProviderModel({
              ...e,
              providerId,
            })
            .then(
              (modelInfo) => {
                setAddModal(false)
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
