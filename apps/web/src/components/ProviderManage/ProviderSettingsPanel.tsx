import type { ProviderAuthStatus, ProviderPublicView, ProviderUsageStatus, UpdateProviderConfigSchema } from '@ant-chat/shared'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { Progress } from '@workspace/ui/components/progress'
import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { providerApi } from '@/api/providerApi'
import { ModelList } from '@/components/ProviderManage/ModelList/ModelList'
import { AI_OFFICIAL_API_INFO } from '@/constants'

export interface ProviderSettingsPanelProps {
  item: ProviderPublicView | null
  isOffcial?: boolean
  onChange?: (e: UpdateProviderConfigSchema) => void
  onDelete?: () => void
}

export function ProviderSettingsPanel({ item, onChange, onDelete }: ProviderSettingsPanelProps) {
  const [apiKeyValue, setApiKeyValue] = useState<string>('')
  const [showKey, setShowKey] = useState(false)
  const [authStatus, setAuthStatus] = useState<ProviderAuthStatus | null>(null)
  const [usage, setUsage] = useState<ProviderUsageStatus | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [prevProviderId, setPrevProviderId] = useState<string | undefined>(item?.id)

  // Provider 切换时（组件复用、不卸载）在渲染期清空 API Key 输入状态：
  // 否则上一个 Provider 的密钥草稿会串显到下一个 Provider 的输入框，
  // 并被 onBlur 误保存为当前 Provider 的密钥。
  if (prevProviderId !== item?.id) {
    setPrevProviderId(item?.id)
    setApiKeyValue('')
    setShowKey(false)
  }

  useEffect(() => {
    let active = true
    if (item?.capabilities?.authentication !== 'oauth') {
      return () => {
        active = false
      }
    }
    void providerApi.getAuthStatus(item.id).then((status) => {
      if (active) {
        setAuthStatus(status)
      }
    }).catch((error: unknown) => {
      if (active) {
        toast.error(`读取订阅登录状态失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
    return () => {
      active = false
    }
  }, [item?.capabilities?.authentication, item?.id])

  // 使用 item.hasApiKey 判断是否已配置密钥（不再调 getProviderApiKey 回显原值）
  const hasKey = item?.hasApiKey ?? false

  if (!item) {
    return null
  }

  const officialApiUrl = getOfficialApiUrl(item.id)
  const officialKeyUrl = getOfficialKeyUrl(item.id)
  const primaryUsageWindow = usage?.primaryWindow
  const usagePercent = primaryUsageWindow
    ? Math.min(Math.max(primaryUsageWindow.usedPercent, 0), 100)
    : 0

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
        {
          // fixed endpoint（如 Codex 订阅）由 Integration 固定，用户不可自定义，也不展示。
          item.capabilities?.endpoint !== 'fixed' && (
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
          )
        }

        {item.capabilities?.authentication === 'oauth'
          ? (
              <div className="flex flex-col gap-2 rounded-lg border border-border/70 p-3">
                <div className="text-sm font-medium">订阅认证</div>
                <div className="text-xs text-muted-foreground">
                  {authStatus?.authenticated
                    ? `已登录${authStatus.planType ? ` · ${authStatus.planType}` : ''}${authStatus.accountId ? ` · ${authStatus.accountId}` : ''}`
                    : '未登录。登录后凭据会保存到本机 Keychain。'}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={authLoading}
                    onClick={async () => {
                      try {
                        setAuthLoading(true)
                        await providerApi.startOAuthLogin(item.id)
                        toast.success('已打开订阅登录页面，完成授权后刷新状态。')
                      }
                      catch (error) {
                        toast.error(`启动订阅登录失败: ${error instanceof Error ? error.message : String(error)}`)
                      }
                      finally {
                        setAuthLoading(false)
                      }
                    }}
                  >
                    {authStatus?.authenticated ? '重新登录' : '登录订阅'}
                  </Button>
                  {item.capabilities?.localAuthImport && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={authLoading}
                      onClick={async () => {
                        try {
                          setAuthLoading(true)
                          const status = await providerApi.importLocalAuth(item.id)
                          setAuthStatus(status)
                          toast.success('已导入本机 CLI 登录状态。')
                        }
                        catch (error) {
                          toast.error(`导入本机登录失败: ${error instanceof Error ? error.message : String(error)}`)
                        }
                        finally {
                          setAuthLoading(false)
                        }
                      }}
                    >
                      从 CLI 导入
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const status = await providerApi.getAuthStatus(item.id)
                      setAuthStatus(status)
                    }}
                  >
                    刷新状态
                  </Button>
                  {item.capabilities?.usage === 'quota' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!authStatus?.authenticated}
                      onClick={async () => {
                        try {
                          setUsage(await providerApi.getUsage(item.id))
                        }
                        catch (error) {
                          toast.error(`读取额度失败: ${error instanceof Error ? error.message : String(error)}`)
                        }
                      }}
                    >
                      刷新额度
                    </Button>
                  )}
                  {authStatus?.authenticated && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await providerApi.logoutAuth(item.id)
                          setAuthStatus({ authenticated: false, state: 'missing' })
                          setUsage(null)
                          toast.success('已退出订阅登录。')
                        }
                        catch (error) {
                          toast.error(`退出订阅登录失败: ${error instanceof Error ? error.message : String(error)}`)
                        }
                      }}
                    >
                      退出登录
                    </Button>
                  )}
                </div>
                {item.capabilities?.usage === 'quota' && usage && (
                  <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span>当前窗口用量</span>
                      <span className="tabular-nums">
                        {primaryUsageWindow ? `${Math.round(usagePercent)}%` : '未知'}
                      </span>
                    </div>
                    {primaryUsageWindow && (
                      <>
                        <Progress aria-label="当前窗口用量" className="bg-muted" value={usagePercent} />
                        <div className="flex items-center justify-between gap-3">
                          <span className="tabular-nums">
                            {`剩余约 ${Math.round(100 - usagePercent)}%`}
                          </span>
                          <span>
                            {'重置于 '}
                            {new Date(primaryUsageWindow.resetAt * 1000).toLocaleString()}
                          </span>
                        </div>
                      </>
                    )}
                    {usage.creditsBalance && (
                      <span>
                        {'余额 '}
                        {usage.creditsBalance}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          : (
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
            )}

        <div className="flex flex-col gap-1">
          <h2 className="text-base/6 font-semibold">模型列表</h2>
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
