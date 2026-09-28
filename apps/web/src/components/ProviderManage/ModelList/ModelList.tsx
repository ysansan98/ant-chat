import type { ProviderConfigModelSchema } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { Switch } from '@workspace/ui/components/switch'
import { useRequest } from 'ahooks'
import { PlusCircle, RefreshCcw, SearchIcon, Trash2 } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { providerApi } from '@/api/providerApi'
import { AddModelFormModal } from './AddModelForm'
import { getModelCapabilityTags } from './modelCapabilities'

export interface ModelListProps {
  providerId: string
}

export function ModelList({ providerId }: ModelListProps) {
  const [openAddModal, setOpenAddModal] = React.useState(false)
  const [isSyncing, setIsSyncing] = React.useState(false)
  const [isBatchUpdating, setIsBatchUpdating] = React.useState(false)
  const [keyword, setKeyword] = React.useState('')
  const { data, error, loading, refresh, run, mutate } = useRequest(
    providerApi.listProviderModels,
    {
      defaultParams: [providerId],
    },
  )

  React.useEffect(() => {
    run(providerId)
  }, [providerId, run])

  const models = React.useMemo(() => data ?? [], [data])
  const normalizedKeyword = keyword.trim().toLowerCase()
  const filteredModels = React.useMemo(() => {
    if (!normalizedKeyword) {
      return models
    }
    return models.filter(model =>
      model.name.toLowerCase().includes(normalizedKeyword)
      || model.model.toLowerCase().includes(normalizedKeyword),
    )
  }, [models, normalizedKeyword])

  const enabledCount = filteredModels.filter(model => model.isEnabled).length
  const allEnabled = filteredModels.length > 0 && enabledCount === filteredModels.length
  // 部分启用时勾选框显示 indeterminate，避免误导为"已全部启用"。
  const partiallyEnabled = enabledCount > 0 && !allEnabled

  /**
   * 全选启停作用于当前筛选结果：先搜索缩小范围，再一次性启用/禁用。
   */
  const handleToggleAll = async (enabled: boolean) => {
    const modelIds = filteredModels.map(model => model.id)
    if (modelIds.length === 0) {
      return
    }
    setIsBatchUpdating(true)
    try {
      await providerApi.setModelsEnabledStatus(providerId, modelIds, enabled)
      toast.success(enabled ? `已启用 ${modelIds.length} 个模型` : `已禁用 ${modelIds.length} 个模型`)
      refresh()
    }
    catch (e) {
      toast.error(`批量设置失败: ${(e as Error).message}`)
    }
    finally {
      setIsBatchUpdating(false)
    }
  }

  const handleSetEnabled = async (model: ProviderConfigModelSchema, enabled: boolean) => {
    try {
      await providerApi.setModelEnabledStatus(providerId, model.id, enabled)
      refresh()
    }
    catch (e) {
      toast.error(`设置失败: ${(e as Error).message}`)
    }
  }

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

      <div className="mt-2 flex items-center gap-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <SearchIcon className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="搜索模型"
            placeholder="搜索模型名称或 ID"
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
          />
        </InputGroup>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={allEnabled}
            indeterminate={partiallyEnabled}
            disabled={filteredModels.length === 0 || isBatchUpdating}
            onCheckedChange={checked => void handleToggleAll(checked)}
          />
          全部启用
        </label>
        <span className="shrink-0 text-xs text-muted-foreground">
          {`已启用 ${enabledCount}/${filteredModels.length}`}
        </span>
      </div>

      <div className="mt-2 flex max-h-100 flex-col overflow-y-auto rounded-md border border-(--border-color)">
        {!loading && filteredModels.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {models.length === 0 ? '暂无模型' : '没有匹配的模型'}
          </p>
        )}
        {filteredModels.map(item => (
          <div
            key={item.id}
            className={`
              flex items-center justify-between gap-2 border-b border-(--border-color) px-3 py-2
              last:border-0
            `}
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <span className="max-w-full truncate text-sm">{item.name}</span>
              {getModelCapabilityTags(item.capabilities).map(tag => (
                <Badge key={tag} variant="secondary">{tag}</Badge>
              ))}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Switch
                checked={item.isEnabled}
                aria-label={`启用模型：${item.name}`}
                onCheckedChange={checked => void handleSetEnabled(item, checked)}
              />
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
