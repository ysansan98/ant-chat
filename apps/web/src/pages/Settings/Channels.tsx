import type { ChannelAccountView, ChannelSetupResult, ChannelType } from '@ant-chat/shared'
import type { FormEvent } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@workspace/ui/components/alert-dialog'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Field, FieldDescription, FieldLabel, FieldSet } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@workspace/ui/components/radio-group'
import { Switch } from '@workspace/ui/components/switch'
import { AlertCircle, Check, ChevronDown, Plus, RefreshCw, Trash2, X } from 'lucide-react'
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
  /** 已有应用 ID（cli_xxx），填写后走重新授权流程而非创建新应用。 */
  appId?: string
  /** 已存在的频道 ID，填写后重新授权更新该频道的凭证。 */
  channelAccountId?: string
}

const emptyForm: ChannelForm = { channelType: 'feishu', displayName: '', defaultWorkspacePath: '' }

interface ChannelSlot {
  type: ChannelType
  name: string
  description: string
  icon: React.ReactNode
  available: boolean
}

/**
 * 每种平台只支持一个频道（channel_accounts.channel_type 有唯一索引），
 * 所以页面按平台铺出固定槽位，每一行即该平台的接入状态。
 */
const CHANNEL_SLOTS: ChannelSlot[] = [
  { type: 'feishu', name: '飞书私聊', icon: <FeishuLogo />, description: '接收 1v1 文本消息，扫码创建应用后即可从飞书续聊。', available: true },
  { type: 'weixin', name: '个人微信', icon: <WeixinLogo />, description: '个人微信 iLink 接入尚未开放。', available: false },
]

function getPlatformName(type: ChannelType) {
  return CHANNEL_SLOTS.find(slot => slot.type === type)?.name ?? type
}

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

  async function loadPairings(channelId: string, { silent = false } = {}) {
    try {
      const next = await listChannelPairings(channelId)
      setPairings(current => ({ ...current, [channelId]: next }))
    }
    catch (error) {
      if (!silent)
        toast.error(error instanceof Error ? error.message : '读取配对请求失败')
    }
  }

  // 预加载各频道的待批准配对，用于行内徽标展示数量；展开时再刷新一次保证最新。
  useEffect(() => {
    for (const channel of channels)
      void loadPairings(channel.id, { silent: true })
  }, [channels])

  function openSetup(channelType: ChannelType = 'feishu') {
    setForm({ ...emptyForm, channelType })
    setSetupResult(undefined)
    setQrImage(undefined)
    setSetupOpen(true)
  }

  async function startSetup(formToSubmit: ChannelForm) {
    setSaving(true)
    setSetupResult(undefined)
    setQrImage(undefined)
    try {
      const result = await createChannel(formToSubmit)
      setSetupResult(result)
      if (result.status === 'completed') {
        setSetupOpen(false)
        setForm(emptyForm)
        refresh()
        toast.success(result.mode === 'reauth' ? '飞书应用已重新授权并连接' : '消息频道已连接')
      }
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '保存消息频道失败')
    }
    finally {
      setSaving(false)
    }
  }

  async function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await startSetup(form)
  }

  /** 对已有频道重新扫码授权：应用 ID 由后端从已保存凭证读取，前端不接触凭证内容。 */
  function startReauth(channel: ChannelAccountView) {
    const reauthForm: ChannelForm = {
      channelType: channel.channelType,
      displayName: channel.displayName,
      defaultWorkspacePath: channel.defaultWorkspacePath ?? '',
      channelAccountId: channel.id,
    }
    setForm(reauthForm)
    setSetupResult(undefined)
    setQrImage(undefined)
    setSetupOpen(true)
    void startSetup(reauthForm)
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
          toast.success(next.mode === 'reauth' ? '飞书应用已重新授权并连接' : '飞书应用已创建并连接')
        }
      }).catch(() => undefined)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [setupResult])

  function togglePairings(channel: ChannelAccountView) {
    if (expandedId === channel.id) {
      setExpandedId(undefined)
      return
    }
    setExpandedId(channel.id)
    void loadPairings(channel.id)
  }

  return (
    <SettingsPageLayout
      title="消息频道"
      description="把飞书或个人微信接入现有会话。频道不会创建新的用户账号，也不会绕过现有 Agent 权限。"
      variant="wide"
    >
      <section className="flex flex-col gap-3">
        {CHANNEL_SLOTS.map((slot) => {
          const channel = channels.find(item => item.channelType === slot.type)
          return (
            <ChannelSlotRow
              key={slot.type}
              slot={slot}
              channel={channel}
              expanded={channel !== undefined && expandedId === channel.id}
              pairingRequests={channel ? (pairings[channel.id] ?? []) : []}
              onConnect={() => openSetup(slot.type)}
              onTogglePairings={() => {
                if (channel)
                  togglePairings(channel)
              }}
              onRefresh={refresh}
              onReauth={() => {
                if (channel)
                  startReauth(channel)
              }}
              onPairingChange={() => {
                if (channel)
                  void loadPairings(channel.id)
              }}
            />
          )
        })}
      </section>

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{setupResult?.mode === 'reauth' || form.channelAccountId ? '重新授权飞书应用' : `接入${getPlatformName(form.channelType)}`}</DialogTitle>
            <DialogDescription>
              {setupResult
                ? setupResult.mode === 'reauth'
                  ? '确认页会展示本次将更新的权限范围，扫码确认后应用配置随之更新。'
                  : '用飞书扫描二维码完成应用创建，完成后凭证会由系统自动保管。'
                : '飞书通过扫码创建应用；不需要手动填写 App Secret。'}
            </DialogDescription>
          </DialogHeader>
          {setupResult
            ? (
                <div className="flex flex-col items-center gap-4 py-3 text-center">
                  {qrImage
                    ? <img src={qrImage} alt="飞书扫码创建应用二维码" className="size-56 rounded-lg bg-white p-3 ring-1 ring-black/10" />
                    : <div className="flex size-56 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">正在生成二维码…</div>}
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {setupResult.status === 'polling' ? '已扫码，正在等待飞书确认' : setupResult.status === 'failed' ? '飞书应用配置失败' : setupResult.status === 'expired' ? '二维码已过期' : setupResult.mode === 'reauth' ? '请使用飞书扫码确认授权' : '请使用飞书扫码创建应用'}
                    </p>
                    <p className="text-xs text-muted-foreground">{setupResult.error ?? (setupResult.mode === 'reauth' ? '将更新已有应用的权限配置，过期后可关闭窗口重新发起。' : '二维码为短期链接，过期后可关闭窗口重新发起。')}</p>
                  </div>
                  {setupResult.verificationUrl && <a className="text-xs text-primary underline-offset-4 hover:underline" href={setupResult.verificationUrl} target="_blank" rel="noreferrer">无法扫码？在飞书中打开验证链接</a>}
                </div>
              )
            : (
                <form id="channel-setup-form" onSubmit={event => void submitSetup(event)} className="space-y-4">
                  <FieldSet>
                    {!form.channelAccountId && (
                      <Field>
                        <FieldLabel>接入方式</FieldLabel>
                        <RadioGroup value={form.appId ? 'reauth' : 'create'} onValueChange={value => setForm({ ...form, appId: value === 'reauth' ? '' : undefined })} className="flex gap-6">
                          <div className="flex items-center gap-2">
                            <RadioGroupItem id="setup-mode-create" value="create" />
                            <Label htmlFor="setup-mode-create" className="cursor-pointer text-sm">创建新应用</Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <RadioGroupItem id="setup-mode-reauth" value="reauth" />
                            <Label htmlFor="setup-mode-reauth" className="cursor-pointer text-sm">绑定已有应用</Label>
                          </div>
                        </RadioGroup>
                        <FieldDescription>绑定已有应用不会创建新应用，扫码确认后更新其权限配置。</FieldDescription>
                      </Field>
                    )}
                    {form.appId !== undefined && (
                      <Field>
                        <FieldLabel htmlFor="channel-app-id">应用 ID</FieldLabel>
                        <Input id="channel-app-id" required placeholder="cli_xxxxx" value={form.appId} onChange={event => setForm({ ...form, appId: event.target.value })} />
                        <FieldDescription>填写飞书开发者后台中的应用 ID（cli_ 开头），请使用该应用的管理员账号扫码确认。</FieldDescription>
                      </Field>
                    )}
                    <Field>
                      <FieldLabel htmlFor="channel-name">显示名称</FieldLabel>
                      <Input id="channel-name" required placeholder="例如：团队飞书" value={form.displayName} onChange={event => setForm({ ...form, displayName: event.target.value })} />
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
            <DialogClose
              render={(
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setSetupResult(undefined)
                    setQrImage(undefined)
                  }}
                />
              )}
            >
              取消
            </DialogClose>
            {!setupResult && <Button type="submit" form="channel-setup-form" disabled={saving} className="active:scale-[0.96]">{saving ? '准备中…' : '开始扫码'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageLayout>
  )
}

/**
 * 平台槽位行：一个平台对应一行。未接入时提供「接入」入口；
 * 已接入时展示连接状态，提供开关、配对处理、重新授权与删除。
 */
function ChannelSlotRow({ slot, channel, expanded, pairingRequests, onConnect, onTogglePairings, onRefresh, onReauth, onPairingChange }: {
  slot: ChannelSlot
  channel?: ChannelAccountView
  expanded: boolean
  pairingRequests: Awaited<ReturnType<typeof listChannelPairings>>
  onConnect: () => void
  onTogglePairings: () => void
  onRefresh: () => void
  onReauth: () => void
  onPairingChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const status = channel ? getStatusLabel(channel) : undefined

  async function toggleEnabled(enabled: boolean) {
    if (!channel)
      return
    setBusy(true)
    try {
      await (enabled ? enableChannel(channel.id) : disableChannel(channel.id))
      onRefresh()
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '切换频道状态失败')
    }
    finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!channel)
      return
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
    <Card size="sm">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          {slot.icon}
          <div className="min-w-0">
            {channel
              ? (
                  <>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <CardTitle className="text-base font-semibold">{channel.displayName}</CardTitle>
                      <Badge variant="outline">{slot.name}</Badge>
                      {status && <Badge variant={status.variant}>{status.label}</Badge>}
                    </div>
                    <CardDescription className="mt-0.5">
                      默认工作区：
                      {channel.defaultWorkspacePath ?? '尚未配置'}
                      {!channel.hasCredential && <span className="text-destructive"> · 缺少凭证</span>}
                    </CardDescription>
                  </>
                )
              : (
                  <>
                    <CardTitle className="text-base font-semibold">{slot.name}</CardTitle>
                    <CardDescription className="mt-0.5">{slot.description}</CardDescription>
                  </>
                )}
          </div>
        </div>
        <CardAction>
          {channel
            ? (
                <Switch
                  checked={channel.enabled}
                  disabled={busy}
                  onCheckedChange={enabled => void toggleEnabled(enabled)}
                  aria-label={channel.enabled ? '停用频道' : '启用频道'}
                />
              )
            : (
                <Button size="sm" disabled={!slot.available} onClick={onConnect}>
                  <Plus className="size-3.5" />
                  接入
                </Button>
              )}
        </CardAction>
      </CardHeader>
      {channel && expanded && <CardContent><PairingRequests requests={pairingRequests} onChange={onPairingChange} /></CardContent>}
      {channel && (
        <CardFooter className="justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onTogglePairings} className="transition-colors hover:bg-accent">
            配对请求
            {pairingRequests.length > 0 && <Badge variant="secondary" className="ml-1">{pairingRequests.length}</Badge>}
            <ChevronDown className={`size-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </Button>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={busy} onClick={onReauth} title="重新扫码授权，更新该应用的权限配置">
              <RefreshCw className="size-3.5" />
              重新授权
            </Button>
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" disabled={busy} aria-label="删除频道"><Trash2 className="size-4 text-muted-foreground" /></Button>} />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    删除频道「
                    {channel.displayName}
                    」？
                  </AlertDialogTitle>
                  <AlertDialogDescription>频道将断开连接并从列表中移除，历史会话与消息会保留。此操作无法撤销。</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void disconnect()}>确认删除</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardFooter>
      )}
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

function getStatusLabel(channel: ChannelAccountView): { label: string, variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
  if (!channel.enabled)
    return { label: '已停用', variant: 'secondary' }
  if (channel.status === 'connected')
    return { label: '已连接', variant: 'default' }
  if (channel.status === 'degraded')
    return { label: '连接异常', variant: 'destructive' }
  if (channel.status === 'connecting')
    return { label: '连接中', variant: 'outline' }
  if (channel.status === 'configured')
    return { label: '待启用', variant: 'secondary' }
  return { label: '已断开', variant: 'secondary' }
}

function WeixinLogo() {
  return (
    <div className="flex size-8 items-center justify-center rounded-md" style={{ background: '#07c160' }}>
      <svg fill="currentColor" viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" color="#fff">
        <title>微信</title>
        <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098c.922.268 1.877.403 2.837.403.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18v.001zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.721.721 0 01.598.082l1.584.926c.041.028.09.044.14.047.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.584.584 0 01-.023-.156.49.49 0 01.201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03l.001-.002zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.97-.982h-.001zm4.844 0c.535 0 .969.44.969.982a.976.976 0 01-.969.983.976.976 0 01-.969-.983c0-.542.434-.982.969-.982z">
        </path>
      </svg>
    </div>
  )
}

function FeishuLogo() {
  return (
    <div className="flex size-8 items-center justify-center rounded-md" style={{ background: 'white' }}>
      <svg height="24" width="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" color="#fff">
        <title>飞书</title>
        <path d="M18.141 7.833a8.387 8.387 0 00-2.749 1.54c-.145.122-.595.554-1.348 1.297-.444.437-.89.874-1.335 1.309a.32.32 0 01-.074.052 58.403 58.403 0 00-.977-1.63 30.364 30.364 0 00-7.474-7.995c-.104-.078-.223-.2-.13-.324A.195.195 0 014.22 2c2.782.004 6.215.005 10.297.003.564 0 .868.298 1.224.765a13.923 13.923 0 012.374 4.87c.014.05.023.116.027.195z" fill="#01D6BA"></path>
        <path d="M20.429 14.612a2.4 2.4 0 00-.645.52.468.468 0 01-.064.062c-1.08.82-2.29 1.213-3.63 1.179-.58-.015-1.266-.142-2.061-.381a32.717 32.717 0 01-3.962-1.468 7.646 7.646 0 00-.27-.115 2.494 2.494 0 01-.264-.124 14.329 14.329 0 003.024-2.158.373.373 0 00.078-.096.32.32 0 00.074-.052c.446-.435.891-.872 1.335-1.31.753-.742 1.203-1.174 1.348-1.296a8.387 8.387 0 012.75-1.54c.284-.085.518-.146.701-.186 1.842-.397 3.611-.193 5.31.611l.014.011a.038.038 0 01.006.035.038.038 0 01-.01.015 7.74 7.74 0 00-1.405 1.918c-.028.054-.543 1.08-1.544 3.078a10.16 10.16 0 01-.785 1.297z" fill="#153C9B"></path>
        <path d="M9.533 14.285c.087.047.175.089.264.124.098.04.188.078.27.115a32.71 32.71 0 003.962 1.468c.795.239 1.482.366 2.06.38 1.34.035 2.551-.358 3.631-1.178a.467.467 0 00.064-.062 2.4 2.4 0 01.645-.52 6.841 6.841 0 01-.61.92c-1.227 1.575-2.69 2.856-4.424 3.812a14.181 14.181 0 01-13.704-.025c-.364-.202-.82-.452-1.142-.747-.315-.29-.367-.663-.366-1.122L.175 8.081c0-.104.005-.201.015-.29a.162.162 0 01.161-.143c.059 0 .117.03.174.091 2.595 2.735 5.561 4.905 8.899 6.51.039.018.075.03.109.036z" fill="#3370FF"></path>
      </svg>
    </div>
  )
}
