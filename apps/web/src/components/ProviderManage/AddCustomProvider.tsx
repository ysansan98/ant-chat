import type { CreateProviderConfigSchema, ProviderFormat, ProviderIntegrationId } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Switch } from '@workspace/ui/components/switch'
import { useRequest } from 'ahooks'
import { Plus } from 'lucide-react'
import { nanoid } from 'nanoid'
import React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { providerApi } from '@/api/providerApi'

interface AddCustomProviderProps {
  onAdd: (provider: CreateProviderConfigSchema) => Promise<void>
  existingProviderIds?: string[]
  loading?: boolean
}

interface ProviderFormValues {
  name: string
  baseUrl: string
  apiKey: string
  apiMode: ProviderFormat
  integrationId: ProviderIntegrationId
  isEnabled: boolean
}

const DEFAULT_PROVIDER_FORM_VALUES: ProviderFormValues = {
  name: '',
  apiMode: 'openai',
  integrationId: 'api-key',
  baseUrl: '',
  apiKey: '',
  isEnabled: true,
}

const API_MODE_OPTIONS: Record<ProviderFormat, string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic 兼容',
  google: 'Google 兼容',
  deepseek: 'DeepSeek 兼容',
}

export function AddCustomProvider({ onAdd, existingProviderIds, loading }: AddCustomProviderProps) {
  const { register, handleSubmit, reset, setValue, watch } = useForm<ProviderFormValues>({
    defaultValues: DEFAULT_PROVIDER_FORM_VALUES,
  })

  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [selectedModelsDevProviderId, setSelectedModelsDevProviderId] = React.useState<string | null>(null)
  const integrationId = watch('integrationId')
  const apiMode = watch('apiMode')
  const { data: integrationCatalog } = useRequest(providerApi.listIntegrations)
  const integrationDescriptor = integrationCatalog?.find(descriptor => descriptor.id === integrationId)
  const { data: modelsDevProviders, run } = useRequest(
    providerApi.getModelsDevProviders,
    { manual: true },
  )

  const availableModelsDevProviders = React.useMemo(() => {
    if (!modelsDevProviders) {
      return []
    }
    const existingIds = new Set(existingProviderIds || [])
    return modelsDevProviders.filter(provider => !existingIds.has(provider.id))
  }, [modelsDevProviders, existingProviderIds])

  const handleSubmitForm = handleSubmit(async (values) => {
    try {
      setIsSubmitting(true)
      const descriptor = integrationCatalog?.find(item => item.id === values.integrationId)
      if (!descriptor) {
        throw new Error('产品集成目录尚未加载，请稍后重试。')
      }

      const providerData: CreateProviderConfigSchema = {
        id: selectedModelsDevProviderId || nanoid(),
        name: values.name,
        baseUrl: descriptor.fixedBaseUrl ?? values.baseUrl,
        integrationId: descriptor.id,
        ...(descriptor.authentication === 'api-key' && values.apiKey ? { apiKey: values.apiKey } : {}),
        apiMode: descriptor.fixedApiMode ?? values.apiMode,
        isEnabled: values.isEnabled ?? true,
      }

      await onAdd(providerData)
      toast.success('自定义提供商添加成功')
      setIsModalOpen(false)
      reset(DEFAULT_PROVIDER_FORM_VALUES)
      setSelectedModelsDevProviderId(null)
    }
    catch (error) {
      if (error instanceof Error) {
        toast.error(`添加失败: ${error.message}`)
      }
      else {
        toast.error('添加失败，请重试')
      }
    }
    finally {
      setIsSubmitting(false)
    }
  })

  const handleCancel = () => {
    setIsModalOpen(false)
    reset(DEFAULT_PROVIDER_FORM_VALUES)
    setSelectedModelsDevProviderId(null)
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setIsModalOpen(true)
          run()
        }}
        disabled={loading}
        className="w-full"
      >
        <Plus className="size-4" />
        添加自定义提供商
      </Button>

      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleCancel()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加自定义提供商</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitForm} className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="models-dev-select" className="text-sm font-medium">从 Models.dev 选择</label>
              <Select
                items={availableModelsDevProviders.map(provider => ({
                  label: `${provider.name} (${provider.id})`,
                  value: provider.id,
                }))}
                value={selectedModelsDevProviderId}
                onValueChange={(value) => {
                  if (!value) {
                    setSelectedModelsDevProviderId(null)
                    return
                  }
                  const provider = availableModelsDevProviders.find(item => item.id === value)
                  if (!provider) {
                    setSelectedModelsDevProviderId(null)
                    return
                  }
                  setSelectedModelsDevProviderId(provider.id)
                  setValue('name', provider.name)
                  setValue('apiMode', provider.apiMode)
                  setValue('integrationId', 'api-key')
                  setValue('baseUrl', provider.baseUrl)
                }}
              >
                <SelectTrigger id="models-dev-select">
                  <SelectValue placeholder="选择服务商" />
                </SelectTrigger>
                <SelectContent>
                  {availableModelsDevProviders.map(provider => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                      {' '}
                      (
                      {provider.id}
                      )
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="provider-name" className="text-sm font-medium">提供商名称 *</label>
              <Input id="provider-name" placeholder="例如：我的自定义 AI" {...register('name', { required: true, minLength: 2, maxLength: 50 })} />
            </div>

            {
              // fixed endpoint（如 Codex 订阅）由 descriptor 固定，提交时自动使用 fixedBaseUrl，无需用户填写也不展示。
              !integrationDescriptor?.fixedBaseUrl && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="provider-base-url" className="text-sm font-medium">API 地址 *</label>
                  <Input
                    id="provider-base-url"
                    placeholder="https://api.example.com"
                    {...register('baseUrl', { required: true })}
                  />
                </div>
              )
            }

            {integrationDescriptor?.authentication === 'api-key' && (
              <div className="flex flex-col gap-1">
                <label htmlFor="provider-api-key" className="text-sm font-medium">API Key *</label>
                <Input
                  id="provider-api-key"
                  type="password"
                  placeholder="输入你的API Key"
                  {...register('apiKey', { validate: value => integrationDescriptor?.authentication !== 'api-key' || Boolean(value) || '请输入 API Key' })}
                />
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor="provider-api-mode" className="text-sm font-medium">API 模式 *</label>
              <Select
                items={API_MODE_OPTIONS}
                value={apiMode}
                disabled={Boolean(integrationDescriptor?.fixedApiMode)}
                onValueChange={(value) => {
                  if (value) {
                    setValue('apiMode', value as ProviderFormat)
                  }
                }}
              >
                <SelectTrigger id="provider-api-mode">
                  <SelectValue placeholder="选择API兼容模式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI 兼容</SelectItem>
                  <SelectItem value="anthropic">Anthropic 兼容</SelectItem>
                  <SelectItem value="google">Google 兼容</SelectItem>
                  <SelectItem value="deepseek">DeepSeek 兼容</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="provider-integration" className="text-sm font-medium">产品集成 *</label>
              <Select
                items={(integrationCatalog ?? []).map(descriptor => ({
                  label: descriptor.label,
                  value: descriptor.id,
                }))}
                value={integrationId}
                onValueChange={(value) => {
                  if (!value) {
                    return
                  }
                  const descriptor = integrationCatalog?.find(item => item.id === value)
                  if (!descriptor) {
                    return
                  }
                  setSelectedModelsDevProviderId(null)
                  setValue('integrationId', descriptor.id)
                  setValue('apiMode', descriptor.fixedApiMode ?? descriptor.defaultApiMode)
                  setValue('baseUrl', descriptor.fixedBaseUrl ?? '')
                  setValue('apiKey', '')
                }}
              >
                <SelectTrigger id="provider-integration">
                  <SelectValue placeholder="选择产品集成" />
                </SelectTrigger>
                <SelectContent>
                  {(integrationCatalog ?? []).map(descriptor => (
                    <SelectItem key={descriptor.id} value={descriptor.id}>{descriptor.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <label htmlFor="provider-enabled" className="text-sm font-medium">启用状态</label>
              <Switch
                id="provider-enabled"
                checked={watch('isEnabled')}
                onCheckedChange={v => setValue('isEnabled', v)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCancel}>
                取消
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? '添加中...' : '添加'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
