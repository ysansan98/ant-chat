import type { CreateProviderConfigSchema, ProviderFormat } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/field'
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
  isEnabled: boolean
}

const DEFAULT_PROVIDER_FORM_VALUES: ProviderFormValues = {
  name: '',
  apiMode: 'openai',
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
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ProviderFormValues>({
    defaultValues: DEFAULT_PROVIDER_FORM_VALUES,
  })

  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [selectedModelsDevProviderId, setSelectedModelsDevProviderId] = React.useState<string | null>(null)
  const apiMode = watch('apiMode')
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

      const providerData: CreateProviderConfigSchema = {
        id: selectedModelsDevProviderId || nanoid(),
        name: values.name,
        baseUrl: values.baseUrl,
        // 自定义提供商统一走 API Key 认证；订阅（OAuth）服务商是内置的，不走此入口。
        integrationId: 'api-key',
        ...(values.apiKey ? { apiKey: values.apiKey } : {}),
        apiMode: values.apiMode,
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
        variant="secondary"
        onClick={() => {
          setIsModalOpen(true)
          run()
        }}
        disabled={loading}
        className="w-full"
      >
        <Plus className="size-3.5" />
        添加
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
            <Field>
              <FieldLabel htmlFor="models-dev-select">从 Models.dev 选择</FieldLabel>
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
                  setValue('baseUrl', provider.baseUrl)
                }}
              >
                <SelectTrigger id="models-dev-select" className="w-full">
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
            </Field>

            <Field>
              <FieldLabel htmlFor="provider-name">提供商名称 *</FieldLabel>
              <Input
                id="provider-name"
                placeholder="例如：我的自定义 AI"
                aria-invalid={!!errors.name}
                {...register('name', {
                  required: '请输入提供商名称',
                  minLength: { value: 2, message: '提供商名称至少 2 个字符' },
                  maxLength: { value: 50, message: '提供商名称最多 50 个字符' },
                })}
              />
              <FieldError errors={[errors.name]} />
            </Field>

            {/* 自定义提供商统一使用 API Key 认证，endpoint 由用户填写。 */}
            <Field>
              <FieldLabel htmlFor="provider-base-url">API 地址 *</FieldLabel>
              <Input
                id="provider-base-url"
                placeholder="https://api.example.com"
                aria-invalid={!!errors.baseUrl}
                {...register('baseUrl', {
                  required: '请输入 API 地址',
                })}
              />
              <FieldError errors={[errors.baseUrl]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="provider-api-key">API Key *</FieldLabel>
              <Input
                id="provider-api-key"
                type="password"
                placeholder="输入你的API Key"
                aria-invalid={!!errors.apiKey}
                {...register('apiKey', {
                  required: '请输入 API Key',
                })}
              />
              <FieldError errors={[errors.apiKey]} />
            </Field>

            <Field>
              <FieldLabel htmlFor="provider-api-mode">API 模式 *</FieldLabel>
              <Select
                items={API_MODE_OPTIONS}
                value={apiMode}
                onValueChange={(value) => {
                  if (value) {
                    setValue('apiMode', value as ProviderFormat)
                  }
                }}
              >
                <SelectTrigger id="provider-api-mode" className="w-full">
                  <SelectValue placeholder="选择API兼容模式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI 兼容</SelectItem>
                  <SelectItem value="anthropic">Anthropic 兼容</SelectItem>
                  <SelectItem value="google">Google 兼容</SelectItem>
                  <SelectItem value="deepseek">DeepSeek 兼容</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field orientation="horizontal">
              <FieldLabel htmlFor="provider-enabled">启用状态</FieldLabel>
              <Switch
                id="provider-enabled"
                checked={watch('isEnabled')}
                onCheckedChange={v => setValue('isEnabled', v)}
              />
            </Field>

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
