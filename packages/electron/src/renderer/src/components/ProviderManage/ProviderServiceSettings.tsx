import type { ServiceProviderSchema, UpdateServiceProviderSchema } from '@ant-chat/shared'
import { Button, Form, Input, Popconfirm } from 'antd'
import { ModelList } from '@/components/ProviderManage/ModelList/ModelList'
import { AI_OFFICIAL_API_INFO } from '@/constants'

export interface ProviderServiceSettingsProps {
  item: ServiceProviderSchema | null
  // 是否为内置提供商
  isOffcial?: boolean
  onChange?: (e: UpdateServiceProviderSchema) => void
  onDelete?: () => void
}

export function ProviderServiceSettings({ item, onChange, onDelete }: ProviderServiceSettingsProps) {
  if (!item) {
    return null
  }

  const officialApiUrl = getOfficialApiUrl(item.id)
  const officialKeyUrl = getOfficialKeyUrl(item.id)

  return (
    <div className="h-[100dvh] flex-1 overflow-y-auto p-3">
      {
        !item.isOfficial && (
          <div className="flex items-center justify-end">
            <Popconfirm
              title="确认要删除这个提供商吗？"
              onConfirm={onDelete}
              okText="Yes"
              cancelText="No"
            >
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </div>
        )
      }
      <Form layout="vertical" className="flex flex-col gap-4" initialValues={item}>
        <Form.Item
          label={<span className="font-medium">API URL</span>}
          name="baseUrl"
          help={
            officialApiUrl
            && (
              <div className="mt-1 text-xs">
                官方URL:
                {' '}
                {officialApiUrl}
              </div>
            )
          }
        >
          <Input
            onBlur={(e) => {
              onChange?.({ id: item.id, baseUrl: e.target.value })
            }}
          />
        </Form.Item>

        <Form.Item
          label={<span className="font-medium">API Key</span>}
          name="apiKey"
          help={officialKeyUrl
            && (
              <a
                className="mt-1 text-xs"
                href={officialKeyUrl}
              >
                获取API Key
              </a>
            )}
        >
          <Input.Password
            visibilityToggle={false}
            onBlur={(e) => {
              onChange?.({ id: item.id, apiKey: e.target.value })
            }}
          />
        </Form.Item>

        <Form.Item label={<span className="font-medium">模型列表</span>}>
          <ModelList serviceProviderId={item.id} />
        </Form.Item>
      </Form>
    </div>
  )
}

export function getOfficialApiUrl(provider: string) {
  if (provider in AI_OFFICIAL_API_INFO) {
    return AI_OFFICIAL_API_INFO[provider].url
  }

  return null
}

export function getOfficialKeyUrl(provider: string) {
  if (provider in AI_OFFICIAL_API_INFO) {
    return AI_OFFICIAL_API_INFO[provider].keyUrl
  }

  return null
}
