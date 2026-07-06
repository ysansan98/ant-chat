import type { ProviderConfigSchema, UpdateProviderConfigSchema } from '@ant-chat/shared'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { ModelList } from '@/components/ProviderManage/ModelList/ModelList'
import { AI_OFFICIAL_API_INFO } from '@/constants'

export interface ProviderSettingsPanelProps {
  item: ProviderConfigSchema | null
  isOffcial?: boolean
  onChange?: (e: UpdateProviderConfigSchema) => void
  onDelete?: () => void
}

export function ProviderSettingsPanel({ item, onChange, onDelete }: ProviderSettingsPanelProps) {
  const [apiKeyValue, setApiKeyValue] = useState<string>('')
  const [showKey, setShowKey] = useState(false)

  // 使用 item.hasApiKey 判断是否已配置密钥（不再调 getProviderApiKey 回显原值）
  const hasKey = item?.hasApiKey ?? false

  if (!item) {
    return null
  }

  const officialApiUrl = getOfficialApiUrl(item.id)
  const officialKeyUrl = getOfficialKeyUrl(item.id)

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto p-4">
      {
        !item.isOfficial && (
          <div className="flex items-center justify-end">
            <AlertDialog>
              <AlertDialogTrigger render={<Button size="sm" variant="destructive">删除</Button>} />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认要删除这个提供商吗？</AlertDialogTitle>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>No</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={onDelete}>Yes</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )
      }
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="provider-api-url" className="text-sm font-medium">API URL</label>
          <Input
            id="provider-api-url"
            defaultValue={item.baseUrl}
            onBlur={(e) => {
              onChange?.({ id: item.id, baseUrl: e.target.value })
            }}
          />
          {officialApiUrl && (
            <div className="mt-1 text-xs text-muted-foreground">
              官方URL:
              {' '}
              {officialApiUrl}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="provider-api-key" className="text-sm font-medium">API Key</label>
          <div className="relative">
            <Input
              id="provider-api-key"
              type={showKey ? 'text' : 'password'}
              value={apiKeyValue}
              placeholder={hasKey ? '••••••••••••••••' : '未配置 API Key'}
              onChange={(e) => {
                setApiKeyValue(e.target.value)
              }}
              onBlur={(e) => {
                onChange?.({ id: item.id, apiKey: e.target.value })
              }}
              className="pr-10"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-muted-foreground hover:text-foreground"
              onClick={() => setShowKey(!showKey)}
              tabIndex={-1}
              aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {officialKeyUrl && (
            <a className="mt-1 text-xs" href={officialKeyUrl}>
              获取API Key
            </a>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <h2 className="text-base leading-6 font-semibold">模型列表</h2>
          <ModelList providerId={item.id} />
        </div>
      </div>
    </div>
  )
}

function getOfficialApiUrl(provider: string) {
  if (provider in AI_OFFICIAL_API_INFO) {
    return AI_OFFICIAL_API_INFO[provider].url
  }

  return null
}

function getOfficialKeyUrl(provider: string) {
  if (provider in AI_OFFICIAL_API_INFO) {
    return AI_OFFICIAL_API_INFO[provider].keyUrl
  }

  return null
}
