import type { MemoryCatalogListEntry } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { ArchiveIcon, CheckIcon, EyeIcon, MessageSquareTextIcon } from 'lucide-react'
import React from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { memoryCatalogApi } from '@/api/memoryCatalogApi'
import { activatePersistedConversationSession } from '@/store/workspaceSession'
import { SettingsPageLayout } from './SettingsPageLayout'

type CatalogStatus = 'pending' | 'active' | 'archived'

interface CatalogState {
  status: 'loading' | 'ready' | 'error'
  entries: MemoryCatalogListEntry[]
  error?: string
}
const TAB_LABELS: Array<{ value: CatalogStatus, label: string }> = [
  { value: 'pending', label: '待批准' },
  { value: 'active', label: '已批准' },
  { value: 'archived', label: '已归档' },
]

export function MemoryCatalogSettings() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = React.useState<CatalogStatus>('pending')
  const [state, setState] = React.useState<CatalogState>({ status: 'loading', entries: [] })
  const [bodyTarget, setBodyTarget] = React.useState<MemoryCatalogListEntry | null>(null)
  const [bodyText, setBodyText] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async (status: CatalogStatus) => {
    setState({ status: 'loading', entries: [] })
    try {
      const entries = await memoryCatalogApi.list(status)
      setState({ status: 'ready', entries })
    }
    catch (error) {
      setState({ status: 'error', entries: [], error: error instanceof Error ? error.message : '加载记忆失败' })
    }
  }, [])

  React.useEffect(() => {
    void load(activeTab)
  }, [activeTab, load])

  async function approve(entry: MemoryCatalogListEntry) {
    setBusy(true)
    try {
      const record = await memoryCatalogApi.approve(entry.memory.id)
      toast.success(`已批准记忆「${record.title}」`)
      await load(activeTab)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '批准失败')
    }
    finally {
      setBusy(false)
    }
  }

  async function archive(entry: MemoryCatalogListEntry) {
    setBusy(true)
    try {
      const record = await memoryCatalogApi.archive(entry.memory.id)
      toast.success(`已归档记忆「${record.title}」`)
      await load(activeTab)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '归档失败')
    }
    finally {
      setBusy(false)
    }
  }

  async function openBody(entry: MemoryCatalogListEntry) {
    setBodyTarget(entry)
    setBodyText(null)
    try {
      const body = await memoryCatalogApi.getBody(entry.memory.id)
      setBodyText(body)
    }
    catch (error) {
      setBodyText(`加载正文失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  async function jumpToEvidence(messageId: string, conversationId: string) {
    try {
      await activatePersistedConversationSession(conversationId)
      navigate(`/chat?jumpToMessage=${encodeURIComponent(messageId)}`)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : '打开会话失败')
    }
  }

  if (state.status === 'error') {
    return (
      <SettingsPageLayout
        title="长期记忆"
        description={state.error}
        actions={(
          <Button variant="outline" onClick={() => void load(activeTab)}>重试</Button>
        )}
        variant="wide"
      >
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            加载记忆目录失败，请重试。
          </CardContent>
        </Card>
      </SettingsPageLayout>
    )
  }

  return (
    <SettingsPageLayout
      title="长期记忆"
      description="Agent 提议、人工批准的结论层；只有批准后的记忆才会参与检索。"
      variant="wide"
    >
      <Tabs value={activeTab} onValueChange={value => setActiveTab(value as CatalogStatus)}>
        <TabsList variant="line" className="mb-2">
          {TAB_LABELS.map(tab => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TAB_LABELS.map(tab => (
          <TabsContent key={tab.value} value={tab.value} className="min-h-0 space-y-3">
            {state.status === 'loading'
              ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
                    <Spinner className="size-3" />
                    正在加载...
                  </div>
                )
              : state.entries.length === 0
                ? (
                    <div className="py-12 text-center text-sm text-muted-foreground">
                      暂无
                      {tab.label}
                      记忆
                    </div>
                  )
                : state.entries.map(entry => (
                    <MemoryCard
                      key={entry.memory.id}
                      entry={entry}
                      busy={busy}
                      onApprove={() => void approve(entry)}
                      onArchive={() => void archive(entry)}
                      onViewBody={() => void openBody(entry)}
                      onJumpToEvidence={(messageId, conversationId) => void jumpToEvidence(messageId, conversationId)}
                    />
                  ))}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog
        open={bodyTarget !== null}
        onOpenChange={(open) => {
          if (!open)
            setBodyTarget(null)
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{bodyTarget?.memory.title}</DialogTitle>
            <DialogDescription>{bodyTarget?.memory.summary}</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-y-auto rounded-md border border-border bg-muted p-3 font-mono text-xs/5 whitespace-pre-wrap text-foreground">
            {bodyText ?? '正在加载正文...'}
          </pre>
        </DialogContent>
      </Dialog>
    </SettingsPageLayout>
  )
}

function MemoryCard({
  entry,
  busy,
  onApprove,
  onArchive,
  onViewBody,
  onJumpToEvidence,
}: {
  entry: MemoryCatalogListEntry
  busy: boolean
  onApprove: () => void
  onArchive: () => void
  onViewBody: () => void
  onJumpToEvidence: (messageId: string, conversationId: string) => void
}) {
  const memory = entry.memory
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base/6 font-semibold">{memory.title}</CardTitle>
          <CardDescription className="text-sm text-pretty">{memory.summary}</CardDescription>
          <p className="truncate text-xs text-muted-foreground">
            {memory.workspacePath}
            {' · '}
            {formatTime(memory.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline">{memory.status === 'pending' ? '待批准' : memory.status === 'active' ? '已批准' : '已归档'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {entry.evidence.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">证据</p>
            {entry.evidence.map(evidence => (
              <button
                key={evidence.messageId}
                type="button"
                className="flex w-full items-start gap-2 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-left transition-colors hover:bg-accent"
                onClick={() => onJumpToEvidence(evidence.messageId, evidence.conversationId)}
              >
                <MessageSquareTextIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-muted-foreground">
                    {evidence.conversationTitle || '未命名会话'}
                    {' · '}
                    {formatTime(evidence.createdAt)}
                  </span>
                  <span className="line-clamp-2 block text-sm">{evidence.text || '（无文本内容）'}</span>
                </span>
                <EyeIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          {memory.status === 'pending' && (
            <Button size="sm" disabled={busy} onClick={onApprove}>
              <CheckIcon className="size-4" />
              批准
            </Button>
          )}
          {memory.status !== 'archived' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onArchive}>
              <ArchiveIcon className="size-4" />
              归档
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={onViewBody}>
            查看正文
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
