import type { ProviderConfigSchema, UpdateProviderConfigSchema } from '@ant-chat/shared'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { ModelList } from '@/components/ProviderManage/ModelList/ModelList'
import { AI_OFFICIAL_API_INFO } from '@/constants'

export interface ProviderSettingsPanelProps {
  item: ProviderConfigSchema | null
  isOffcial?: boolean
  onChange?: (e: UpdateProviderConfigSchema) => void
  onDelete?: () => void
}

export function ProviderSettingsPanel({ item, onChange, onDelete }: ProviderSettingsPanelProps) {
  if (!item) {
    return null
  }

  const officialApiUrl = getOfficialApiUrl(item.id)
  const officialKeyUrl = getOfficialKeyUrl(item.id)

  return (
    <div className="h-full flex-1 overflow-y-auto p-3">
      {
        !item.isOfficial && (
          <div className="flex items-center justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">删除</Button>
              </AlertDialogTrigger>
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
          <label htmlFor="provider-api-url" className="font-medium">API URL</label>
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
          <label htmlFor="provider-api-key" className="font-medium">API Key</label>
          <Input
            id="provider-api-key"
            type="password"
            defaultValue={item.apiKey}
            onBlur={(e) => {
              onChange?.({ id: item.id, apiKey: e.target.value })
            }}
          />
          {officialKeyUrl && (
            <a className="mt-1 text-xs" href={officialKeyUrl}>
              获取API Key
            </a>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <span className="font-medium">模型列表</span>
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
