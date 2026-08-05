import type { BrowserIdentityStatus, BrowserProfileSourceView } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { CheckCircle2, FolderOpen, Globe2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { browserProfilesApi } from '@/api/browserProfilesApi'
import { getAppRuntimeCapabilities } from '@/api/transports/appRpc'
import { SettingsPageLayout } from './SettingsPageLayout'

export function BrowserProfilesSettings() {
  const [status, setStatus] = useState<BrowserIdentityStatus | null>(null)
  const [sources, setSources] = useState<BrowserProfileSourceView[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false)
  const nativeFilePicker = getAppRuntimeCapabilities().nativeFilePicker

  const refresh = useCallback(async () => {
    const [nextStatus, nextSources] = await Promise.all([
      browserProfilesApi.getStatus(),
      browserProfilesApi.listSources(),
    ])
    setStatus(nextStatus)
    setSources(nextSources)
  }, [])

  useEffect(() => {
    void refresh().catch(error => toast.error(error instanceof Error ? error.message : '读取浏览器状态失败')).finally(() => setLoading(false))
  }, [refresh])

  async function importSource(sourceId?: string) {
    setWorking(true)
    try {
      const nextStatus = await browserProfilesApi.importSource(sourceId)
      setStatus(nextStatus)
      setSourceDialogOpen(false)
      toast.success('浏览器 Cookies 已更新')
    }
    catch (error) {
      // 失败时只展示错误，不清空旧状态；后端导入本身也是事务性的。
      toast.error(error instanceof Error ? error.message : '导入浏览器 Cookies 失败')
      await refresh().catch(() => {})
    }
    finally {
      setWorking(false)
    }
  }

  async function clearState() {
    setWorking(true)
    try {
      await browserProfilesApi.clear()
      setStatus({ imported: false })
      toast.success('浏览器 Cookies 已清除')
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '清除浏览器 Cookies 失败')
    }
    finally {
      setWorking(false)
    }
  }

  async function chooseDirectory() {
    setWorking(true)
    try {
      const nextStatus = await browserProfilesApi.importFromDirectory()
      if (nextStatus) {
        setStatus(nextStatus)
        setSourceDialogOpen(false)
        toast.success('浏览器 Cookies 已导入')
      }
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '导入浏览器 Cookies 失败')
      await refresh().catch(() => {})
    }
    finally {
      setWorking(false)
    }
  }

  return (
    <SettingsPageLayout
      title="浏览器"
      description="只导入本机浏览器 Cookies，让 Browser 工具在受控的应用会话中继续使用。"
      variant="wide"
    >
      {loading
        ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Spinner />
              {' '}
              正在读取浏览器 Profile…
            </div>
          )
        : (
            <div className="flex flex-col gap-4">
              <Card className="overflow-visible">
                <CardHeader className="border-b">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-2">
                      <CardTitle className="flex items-center gap-2">
                        <Globe2 className="size-4 text-primary" />
                        应用浏览器身份
                      </CardTitle>
                      <CardDescription>只读取 Cookies 并保存应用自己的加密副本，不会删除或写回源浏览器数据。</CardDescription>
                    </div>
                    {status?.imported
                      ? (
                          <Badge variant="secondary">
                            <CheckCircle2 />
                            已导入
                          </Badge>
                        )
                      : <Badge variant="outline">未导入</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  {status?.imported
                    ? (
                        <div className="flex flex-col gap-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <InfoItem label="来源浏览器" value={status.browserName ?? '未知'} />
                            <InfoItem label="Profile" value={status.profileName ?? '未知'} />
                            <InfoItem label="最近导入" value={status.importedAt ? formatDate(status.importedAt) : '未知'} />
                            <InfoItem label="来源状态" value={status.sourceAvailable ? '仍可用' : '不可用，请更换来源'} />
                          </div>
                          {status.error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{status.error}</p> : null}
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => void importSource()} disabled={working || status.sourceAvailable === false}>
                              <RefreshCw className={`${working ? 'animate-spin' : ''} size-3.5`} />
                              更新导入
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setSourceDialogOpen(true)} disabled={working}>更换来源</Button>
                            <Button size="sm" variant="destructive" onClick={() => void clearState()} disabled={working}>
                              <Trash2 className="size-3.5" />
                              清除登录状态
                            </Button>
                          </div>
                        </div>
                      )
                    : (
                        <div className="flex flex-col gap-4">
                          <p className="text-sm text-muted-foreground">选择一个已发现的 Chrome、Edge、Chromium 或 Brave Profile 导入 Cookies。</p>
                          <Button className="w-fit" onClick={() => setSourceDialogOpen(true)}>
                            <FolderOpen />
                            选择浏览器 Profile
                          </Button>
                        </div>
                      )}
                </CardContent>
              </Card>

              <Card className="bg-muted/30">
                <CardContent className="flex gap-3 text-sm text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                  <p>只导入 Cookies，不导入密码、历史记录、扩展、localStorage、IndexedDB 或 Service Worker。导入的 Cookies 只会由 Browser 工具和已明确允许 Browser 的自动化任务使用，并继续受网站访问规则约束。</p>
                </CardContent>
              </Card>
            </div>
          )}

      <Dialog open={sourceDialogOpen} onOpenChange={setSourceDialogOpen}>
        <DialogContent className="sm:max-w-lg" aria-busy={working}>
          <DialogHeader>
            <DialogTitle>选择浏览器 Profile</DialogTitle>
            <DialogDescription>应用只读取 Cookies 并生成自己的加密副本，源浏览器数据不会被清除。</DialogDescription>
          </DialogHeader>
          {working
            ? (
                <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  <Spinner aria-hidden="true" />
                  正在导入浏览器 Cookies，请稍候…
                </div>
              )
            : null}
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {sources.length === 0
              ? <p className="py-4 text-sm text-muted-foreground">没有发现可用的浏览器 Profile。请确认本机仍保留浏览器数据，或使用手动选择。</p>
              : sources.map(source => (
                  <button
                    key={source.sourceId}
                    type="button"
                    className="flex items-center justify-between rounded-md border border-border p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
                    disabled={working || !source.available}
                    onClick={() => void importSource(source.sourceId)}
                  >
                    <span>
                      <span className="block text-sm font-medium">{source.browserName}</span>
                      <span className="block text-xs text-muted-foreground">{source.profileName}</span>
                    </span>
                    <Badge variant={source.available ? 'outline' : 'destructive'}>{source.available ? '可用' : '不可用'}</Badge>
                  </button>
                ))}
          </div>
          {nativeFilePicker
            ? (
                <DialogFooter>
                  <Button variant="outline" onClick={() => void chooseDirectory()} disabled={working}>
                    <FolderOpen />
                    手动选择目录
                  </Button>
                </DialogFooter>
              )
            : null}
        </DialogContent>
      </Dialog>
    </SettingsPageLayout>
  )
}

function InfoItem({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/45 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}
