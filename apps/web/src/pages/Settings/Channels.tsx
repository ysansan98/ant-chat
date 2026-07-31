import type { ChannelAccountView, ChannelSetupResult, ChannelType } from '@ant-chat/shared'
import type { FormEvent } from 'react'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Field, FieldDescription, FieldLabel, FieldSet } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { AlertCircle, Check, ChevronDown, CircleDashed, Link2, MessageCircle, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import * as QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { approveChannelPairing, createChannel, deleteChannel, disableChannel, enableChannel, getChannelSetupStatus, listChannelPairings, listChannels, revokeChannelPairing } from '@/api/channelApi'
import workspaceApi from '@/api/workspaceApi'
import { SettingsPageLayout } from './SettingsPageLayout'

interface ChannelForm {
  channelType: ChannelType
  displayName: string
  defaultWorkspacePath: string
}

const emptyForm: ChannelForm = { channelType: 'feishu', displayName: '', defaultWorkspacePath: '' }

export function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelAccountView[]>([])
  const [workspaces, setWorkspaces] = useState<Array<{ path: string }>>([])
  const [form, setForm] = useState<ChannelForm>(emptyForm)
  const [setupOpen, setSetupOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string>()
  const [pairings, setPairings] = useState<Record<string, Awaited<ReturnType<typeof listChannelPairings>>>>({})
  const [saving, setSaving] = useState(false)
  const [setupResult, setSetupResult] = useState<ChannelSetupResult>()
  const [qrImage, setQrImage] = useState<string>()

  const refresh = () => void listChannels().then(setChannels).catch(() => setChannels([]))

  useEffect(() => {
    refresh()
    void workspaceApi.listWorkspaces()
      .then(result => setWorkspaces(result.workspaces.map(workspace => ({ path: workspace.path }))))
      .catch(() => setWorkspaces([]))
  }, [])

  async function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const result = await createChannel(form)
      setSetupResult(result)
      if (result.status === 'completed') {
        setSetupOpen(false)
        setForm(emptyForm)
        refresh()
        toast.success('消息频道已连接')
      }
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '保存消息频道失败')
    }
    finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!setupResult?.verificationUrl)
      return
    void QRCode.toDataURL(setupResult.verificationUrl, { margin: 1, width: 220 }).then(setQrImage)
  }, [setupResult?.verificationUrl])

  useEffect(() => {
    if (!setupResult || setupResult.status === 'completed' || setupResult.status === 'failed' || setupResult.status === 'expired')
      return
    const timer = window.setInterval(() => {
      void getChannelSetupStatus(setupResult.setupId).then((next) => {
        setSetupResult(next)
        if (next.status === 'completed') {
          setSetupOpen(false)
          setForm(emptyForm)
          refresh()
          toast.success('飞书应用已创建并连接')
        }
      }).catch(() => undefined)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [setupResult])

  async function togglePairings(channel: ChannelAccountView) {
    if (expandedId === channel.id) {
      setExpandedId(undefined)
      return
    }
    setExpandedId(channel.id)
    try {
      const next = await listChannelPairings(channel.id)
      setPairings(current => ({ ...current, [channel.id]: next }))
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '读取配对请求失败')
    }
  }

  return (
    <SettingsPageLayout
      title="消息频道"
      description="把飞书或个人微信接入现有会话。频道不会创建新的用户账号，也不会绕过现有 Agent 权限。"
      variant="wide"
      actions={(
        <Button
          onClick={() => {
            setForm(emptyForm)
            setSetupOpen(true)
          }}
          className="active:scale-[0.96]"
        >
          <Plus className="size-4" />
          添加频道
        </Button>
      )}
    >
      <section className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <MessageCircle className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-medium">一个入口，一条真实会话</p>
              <p className="text-sm text-pretty text-muted-foreground">外部消息会进入现有 Conversation，回复、任务状态和审批沿用 Web/Desktop 的同一条事件链。</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 text-primary" />
            凭证由系统保管
          </div>
          <p className="mt-1 text-xs text-pretty text-muted-foreground">App Secret 和 iLink token 不会展示在列表、消息或前端状态里。</p>
        </div>
      </section>

      {channels.length === 0
        ? (
            <div className="rounded-lg border border-border bg-card">
              <EmptyState icon={<Link2 />} title="还没有消息频道" description="添加一个飞书或个人微信入口，开始从外部消息续聊。">
                <Button variant="outline" onClick={() => setSetupOpen(true)} className="active:scale-[0.96]">
                  <Plus className="size-4" />
                  添加第一个频道
                </Button>
              </EmptyState>
            </div>
          )
        : (
            <section className="grid gap-4 md:grid-cols-2">
              {channels.map(channel => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  expanded={expandedId === channel.id}
                  pairingRequests={pairings[channel.id] ?? []}
                  onTogglePairings={() => void togglePairings(channel)}
                  onRefresh={refresh}
                  onPairingChange={() => void listChannelPairings(channel.id).then(next => setPairings(current => ({ ...current, [channel.id]: next })))}
                />
              ))}
            </section>
          )}

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>添加消息频道</DialogTitle>
            <DialogDescription>{setupResult ? '用飞书扫描二维码完成应用创建，完成后凭证会由系统自动保管。' : '飞书通过扫码创建应用；不需要手动填写 App Secret。'}</DialogDescription>
          </DialogHeader>
          {setupResult
            ? (
                <div className="flex flex-col items-center gap-4 py-3 text-center">
                  {qrImage
                    ? <img src={qrImage} alt="飞书扫码创建应用二维码" className="size-56 rounded-lg bg-white p-3 ring-1 ring-black/10" />
                    : <div className="flex size-56 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">正在生成二维码…</div>}
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {setupResult.status === 'polling' ? '已扫码，正在等待飞书确认' : setupResult.status === 'failed' ? '飞书应用创建失败' : setupResult.status === 'expired' ? '二维码已过期' : '请使用飞书扫码创建应用'}
                    </p>
                    <p className="text-xs text-muted-foreground">{setupResult.error ?? '二维码为短期链接，过期后可关闭窗口重新发起。'}</p>
                  </div>
                  {setupResult.verificationUrl && <a className="text-xs text-primary underline-offset-4 hover:underline" href={setupResult.verificationUrl} target="_blank" rel="noreferrer">无法扫码？在飞书中打开验证链接</a>}
                </div>
              )
            : (
                <form id="channel-setup-form" onSubmit={event => void submitSetup(event)} className="space-y-4">
                  <FieldSet>
                    <Field>
                      <FieldLabel htmlFor="channel-type">平台</FieldLabel>
                      <select id="channel-type" className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" value={form.channelType} onChange={event => setForm({ ...form, channelType: event.target.value as ChannelType })}>
                        <option value="feishu">飞书私聊</option>
                        <option value="weixin" disabled>个人微信（暂未接入）</option>
                      </select>
                      <FieldDescription>使用飞书扫码创建应用，接收 1v1 文本消息。个人微信 iLink 接入尚未开放。</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="channel-name">显示名称</FieldLabel>
                      <Input id="channel-name" required placeholder={form.channelType === 'feishu' ? '例如：团队飞书' : '例如：我的微信'} value={form.displayName} onChange={event => setForm({ ...form, displayName: event.target.value })} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="channel-workspace">默认工作区</FieldLabel>
                      <select id="channel-workspace" required className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" value={form.defaultWorkspacePath} onChange={event => setForm({ ...form, defaultWorkspacePath: event.target.value })}>
                        <option value="">选择工作区</option>
                        {workspaces.map(workspace => <option key={workspace.path} value={workspace.path}>{workspace.path}</option>)}
                      </select>
                    </Field>
                  </FieldSet>
                </form>
              )}
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" disabled={saving} onClick={() => setSetupResult(undefined)} />}>取消</DialogClose>
            {!setupResult && <Button type="submit" form="channel-setup-form" disabled={saving} className="active:scale-[0.96]">{saving ? '准备中…' : '开始扫码'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageLayout>
  )
}

function ChannelCard({ channel, expanded, pairingRequests, onTogglePairings, onRefresh, onPairingChange }: { channel: ChannelAccountView, expanded: boolean, pairingRequests: Awaited<ReturnType<typeof listChannelPairings>>, onTogglePairings: () => void, onRefresh: () => void, onPairingChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const status = getStatusLabel(channel.status)

  async function disconnect() {
    setBusy(true)
    try {
      await deleteChannel(channel.id)
      onRefresh()
      toast.success('频道已删除，历史会话已保留')
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '删除频道失败')
    }
    finally {
      setBusy(false)
    }
  }

  return (
    <Card className="gap-0 transition-colors hover:border-primary/30">
      <CardHeader className="gap-3 border-b border-border/70 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground"><PlatformIcon type={channel.channelType} /></div>
            <div>
              <CardTitle className="text-base text-balance">{channel.displayName}</CardTitle>
              <CardDescription>
                {channel.channelType === 'feishu' ? '飞书私聊' : '个人微信'}
                {' '}
                ·
                {' '}
                {channel.hasCredential ? '已配置凭证' : '缺少凭证'}
              </CardDescription>
            </div>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-start gap-2 text-sm">
          <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">默认工作区</p>
            <p className="truncate" title={channel.defaultWorkspacePath ?? undefined}>{channel.defaultWorkspacePath ?? '尚未配置'}</p>
          </div>
        </div>
        {expanded && <PairingRequests requests={pairingRequests} onChange={onPairingChange} />}
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onTogglePairings} className="transition-colors hover:bg-accent">
          {expanded ? '收起配对' : '查看配对'}
          <ChevronDown className={`size-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </Button>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void (channel.enabled ? disableChannel(channel.id) : enableChannel(channel.id)).then(onRefresh)}>{channel.enabled ? '停用' : '启用'}</Button>
          <Button variant="ghost" size="icon-sm" disabled={busy} onClick={() => void disconnect()} aria-label="删除频道"><Trash2 className="size-4 text-muted-foreground" /></Button>
        </div>
      </CardFooter>
    </Card>
  )
}

function PairingRequests({ requests, onChange }: { requests: Awaited<ReturnType<typeof listChannelPairings>>, onChange: () => void }) {
  if (requests.length === 0)
    return <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">暂无待处理的配对请求。</div>
  return (
    <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        <AlertCircle className="size-4" />
        待批准身份
      </div>
      {requests.map(request => (
        <div key={request.id} className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm">{request.externalDisplayName}</p>
            <p className="truncate text-xs text-muted-foreground">{request.externalUserId}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="sm" onClick={() => void approveChannelPairing(request.id).then(onChange)}>
              <Check className="size-3.5" />
              批准
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void revokeChannelPairing(request.id).then(onChange)}>
              <X className="size-3.5" />
              拒绝
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function PlatformIcon({ type }: { type: ChannelType }) {
  return type === 'feishu' ? <span className="text-base font-semibold">飞</span> : <MessageCircle className="size-5" />
}

function getStatusLabel(status: ChannelAccountView['status']): { label: string, variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
  if (status === 'connected')
    return { label: '已连接', variant: 'default' }
  if (status === 'degraded')
    return { label: '连接异常', variant: 'destructive' }
  if (status === 'connecting')
    return { label: '连接中', variant: 'outline' }
  if (status === 'configured')
    return { label: '待启用', variant: 'secondary' }
  return { label: '已断开', variant: 'secondary' }
}
