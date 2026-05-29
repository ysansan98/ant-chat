import type { AgentProfileFiles } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Textarea } from '@workspace/ui/components/textarea'
import { RotateCcwIcon, SaveIcon } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { profileApi } from '@/api/profileApi'

type ProfileState
  = | { status: 'loading', data?: undefined }
    | { status: 'ready', data: AgentProfileFiles }
    | { status: 'error', data?: undefined, error: string }

export function ProfileSettings() {
  const [state, setState] = React.useState<ProfileState>({ status: 'loading' })
  const [userMarkdown, setUserMarkdown] = React.useState('')
  const [memoryMarkdown, setMemoryMarkdown] = React.useState('')
  const [soulMarkdown, setSoulMarkdown] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const data = await profileApi.getProfile()
      setState({ status: 'ready', data })
      setUserMarkdown(data.userMarkdown)
      setMemoryMarkdown(data.memoryMarkdown)
      setSoulMarkdown(data.soulMarkdown)
    }
    catch (error) {
      setState({ status: 'error', error: (error as Error).message || 'Failed to load profile.' })
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setSaving(true)
    try {
      const data = await profileApi.updateProfile({ memoryMarkdown, userMarkdown, soulMarkdown })
      setState({ status: 'ready', data })
      setUserMarkdown(data.userMarkdown)
      setMemoryMarkdown(data.memoryMarkdown)
      setSoulMarkdown(data.soulMarkdown)
      toast.success('Profile saved')
    }
    catch (error) {
      toast.error((error as Error).message || 'Failed to save profile')
    }
    finally {
      setSaving(false)
    }
  }

  async function rollbackSoul() {
    setSaving(true)
    try {
      const data = await profileApi.rollbackSoul()
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
      <div className="p-4">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>{state.error}</CardDescription>
            <CardAction>
              <Button variant="outline" onClick={() => void load()}>Retry</Button>
            </CardAction>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Agent Profile</CardTitle>
          <CardDescription>
            {state.status === 'ready' ? state.data.profileRootPath : 'Loading...'}
          </CardDescription>
          <CardAction className="flex gap-2">
            <Button
              variant="outline"
              disabled={saving || state.status !== 'ready' || !state.data.lastSoulUpdate}
              onClick={() => void rollbackSoul()}
            >
              <RotateCcwIcon data-icon="inline-start" />
              Rollback SOUL
            </Button>
            <Button disabled={saving || state.status !== 'ready'} onClick={() => void save()}>
              <SaveIcon data-icon="inline-start" />
              Save
            </Button>
          </CardAction>
        </CardHeader>
        {state.status === 'ready' && state.data.lastSoulUpdate
          ? (
              <CardContent className="text-sm text-muted-foreground">
                Last SOUL update:
                {' '}
                {state.data.lastSoulUpdate.summary}
              </CardContent>
            )
          : null}
      </Card>

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
        <ProfileEditor
          title="USER.md"
          description="One user preference per line, separated with §."
          value={userMarkdown}
          disabled={state.status !== 'ready' || saving}
          onChange={setUserMarkdown}
        />
        <ProfileEditor
          title="MEMORY.md"
          description="One agent note per line, separated with §."
          value={memoryMarkdown}
          disabled={state.status !== 'ready' || saving}
          onChange={setMemoryMarkdown}
        />
        <ProfileEditor
          title="SOUL.md"
          description="Stable agent identity. Tool calls cannot edit this file."
          value={soulMarkdown}
          disabled={state.status !== 'ready' || saving}
          onChange={setSoulMarkdown}
        />
      </div>
    </div>
  )
}

function ProfileEditor({
  title,
  description,
  value,
  disabled,
  onChange,
}: {
  title: string
  description: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Card className="min-h-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <Textarea
          value={value}
          disabled={disabled}
          className="h-[calc(100vh-220px)] resize-none font-mono text-sm"
          onChange={event => onChange(event.target.value)}
        />
      </CardContent>
    </Card>
  )
}
