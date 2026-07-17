import type { AgentMemoryFiles } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Input } from '@workspace/ui/components/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { Textarea } from '@workspace/ui/components/textarea'
import { PlusIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { memoryApi } from '@/api/memoryApi'
import { SettingsPageLayout } from './SettingsPageLayout'

type MemoryState
  = | { status: 'loading', data?: undefined }
    | { status: 'ready', data: AgentMemoryFiles }
    | { status: 'error', data?: undefined, error: string }

export function MemorySettings() {
  const [state, setState] = React.useState<MemoryState>({ status: 'loading' })
  const [userMarkdown, setUserMarkdown] = React.useState('')
  const [memoryMarkdown, setMemoryMarkdown] = React.useState('')
  const [soulMarkdown, setSoulMarkdown] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState('user')

  const load = React.useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const data = await memoryApi.getMemoryFiles()
      setState({ status: 'ready', data })
      setUserMarkdown(data.userMarkdown)
      setMemoryMarkdown(data.memoryMarkdown)
      setSoulMarkdown(data.soulMarkdown)
    }
    catch (error) {
      setState({ status: 'error', error: (error as Error).message || 'Failed to load memory.' })
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setSaving(true)
    try {
      const data = await memoryApi.updateMemoryFiles({ memoryMarkdown, userMarkdown, soulMarkdown })
      setState({ status: 'ready', data })
      setUserMarkdown(data.userMarkdown)
      setMemoryMarkdown(data.memoryMarkdown)
      setSoulMarkdown(data.soulMarkdown)
      toast.success('Memory saved')
    }
    catch (error) {
      toast.error((error as Error).message || 'Failed to save memory')
    }
    finally {
      setSaving(false)
    }
  }

  async function rollbackSoul() {
    setSaving(true)
    try {
      const data = await memoryApi.rollbackSoul()
      setState({ status: 'ready', data })
      setUserMarkdown(data.userMarkdown)
      setMemoryMarkdown(data.memoryMarkdown)
      setSoulMarkdown(data.soulMarkdown)
      toast.success('SOUL.md rolled back')
    }
    catch (error) {
      toast.error((error as Error).message || 'Failed to roll back SOUL.md')
    }
    finally {
      setSaving(false)
    }
  }

  if (state.status === 'error') {
    return (
      <SettingsPageLayout
        title="记忆"
        description={state.error}
        actions={(
          <Button variant="outline" onClick={() => void load()}>Retry</Button>
        )}
        variant="wide"
      >
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            加载记忆文件失败，请重试。
          </CardContent>
        </Card>
      </SettingsPageLayout>
    )
  }

  const disabled = state.status !== 'ready' || saving

  return (
    <SettingsPageLayout
      title="记忆"
      description={state.status === 'ready' ? state.data.memoryRootPath : '正在加载...'}
      actions={(
        <>
          <Button
            variant="outline"
            disabled={saving || state.status !== 'ready' || !state.data.lastSoulUpdate}
            onClick={() => void rollbackSoul()}
          >
            <RotateCcwIcon className="size-4" />
            Rollback SOUL
          </Button>
          <Button disabled={saving || state.status !== 'ready'} onClick={() => void save()}>
            <SaveIcon className="size-4" />
            Save
          </Button>
        </>
      )}
      variant="wide"
    >
      {state.status === 'ready' && state.data.lastSoulUpdate
        ? (
            <p className="text-xs/4 text-muted-foreground">
              Last SOUL update:
              {' '}
              {state.data.lastSoulUpdate.summary}
            </p>
          )
        : null}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1">
        <TabsList variant="line" className="mb-2">
          <TabsTrigger value="user">USER.md</TabsTrigger>
          <TabsTrigger value="memory">MEMORY.md</TabsTrigger>
          <TabsTrigger value="soul">SOUL.md</TabsTrigger>
        </TabsList>

        <TabsContent value="user" className="min-h-0 flex-1">
          <EntryListEditor
            value={userMarkdown}
            onChange={setUserMarkdown}
            disabled={disabled}
            placeholder="Add a user preference..."
          />
        </TabsContent>

        <TabsContent value="memory" className="min-h-0 flex-1">
          <EntryListEditor
            value={memoryMarkdown}
            onChange={setMemoryMarkdown}
            disabled={disabled}
            placeholder="Add an agent note..."
          />
        </TabsContent>

        <TabsContent value="soul" className="min-h-0 flex-1">
          <Card className="min-h-0">
            <CardHeader>
              <CardTitle className="text-base/6 font-semibold">SOUL.md</CardTitle>
              <CardDescription className="text-pretty">Stable agent identity. Tool calls cannot edit this file.</CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              <Textarea
                value={soulMarkdown}
                disabled={disabled}
                className="h-[calc(100vh-240px)] resize-none font-mono text-[13px]/5"
                onChange={event => setSoulMarkdown(event.target.value)}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </SettingsPageLayout>
  )
}

interface EntryItem {
  id: string
  text: string
}

function parseEntries(raw: string): EntryItem[] {
  return raw
    .split('§')
    .map(s => s.trim())
    .filter(Boolean)
    .map((text, i) => ({ id: `${i}-${text}`, text }))
}

function EntryListEditor({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  placeholder: string
}) {
  const [newEntry, setNewEntry] = React.useState('')
  const entries = React.useMemo(() => parseEntries(value), [value])

  function updateEntries(updated: EntryItem[]) {
    onChange(updated.map(e => e.text).join('§'))
  }

  function addEntry() {
    const text = newEntry.trim()
    if (!text) {
      return
    }
    const id = `${entries.length}-${text}`
    updateEntries([...entries, { id, text }])
    setNewEntry('')
  }

  function removeEntry(id: string) {
    updateEntries(entries.filter(e => e.id !== id))
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addEntry()
    }
  }

  return (
    <Card className="min-h-0 flex-1">
      <CardContent className="min-h-0 flex-1 space-y-2">
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <div className="space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 360px)' }}>
            {entries.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No entries yet</p>
            )}
            {entries.map(entry => (
              <div
                key={entry.id}
                className="group flex items-center gap-2 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors"
              >
                <span className="min-w-0 flex-1 truncate">{entry.text}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  disabled={disabled}
                  onClick={() => removeEntry(entry.id)}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Input
            value={newEntry}
            disabled={disabled}
            placeholder={placeholder}
            onChange={e => setNewEntry(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            variant="outline"
            size="icon"
            disabled={disabled || !newEntry.trim()}
            onClick={addEntry}
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
