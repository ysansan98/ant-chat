import type { CreateProviderConfigSchema } from '@ant-chat/shared'
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
  apiMode: string
  isEnabled: boolean
}

export function AddCustomProvider({ onAdd, existingProviderIds, loading }: AddCustomProviderProps) {
  const { register, handleSubmit, reset, setValue, watch } = useForm<ProviderFormValues>({
    defaultValues: {
      apiMode: 'openai',
      isEnabled: true,
    },
  })

  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [selectedModelsDevProviderId, setSelectedModelsDevProviderId] = React.useState<string | null>(null)
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
        apiKey: values.apiKey,
        apiMode: values.apiMode as CreateProviderConfigSchema['apiMode'],
        isEnabled: values.isEnabled ?? true,
      }

      await onAdd(providerData)
      toast.success('自定义提供商添加成功')
      setIsModalOpen(false)
      reset()
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
    reset()
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

      <Dialog open={isModalOpen} onOpenChange={handleCancel}>
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
                  setValue('baseUrl', provider.baseUrl)
                  setValue('apiMode', provider.apiMode)
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

            <div className="flex flex-col gap-1">
              <label htmlFor="provider-base-url" className="text-sm font-medium">API 地址 *</label>
              <Input id="provider-base-url" placeholder="https://api.example.com" {...register('baseUrl', { required: true })} />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="provider-api-key" className="text-sm font-medium">API Key *</label>
              <Input id="provider-api-key" type="password" placeholder="输入你的API Key" {...register('apiKey', { required: true })} />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="provider-api-mode" className="text-sm font-medium">API 模式 *</label>
              <Select
                items={{
                  openai: 'OpenAI 兼容',
                  anthropic: 'Anthropic 兼容',
                  google: 'Google 兼容',
                }}
                onValueChange={(value) => {
                  if (value) {
                    setValue('apiMode', value)
                  }
                }}
                defaultValue="openai"
              >
                <SelectTrigger id="provider-api-mode">
                  <SelectValue placeholder="选择API兼容模式" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI 兼容</SelectItem>
                  <SelectItem value="anthropic">Anthropic 兼容</SelectItem>
                  <SelectItem value="google">Google 兼容</SelectItem>
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
