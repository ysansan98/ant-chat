import type { SkillIndex, SkillManifest } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Switch } from '@workspace/ui/components/switch'
import { ArchiveIcon, GitBranchIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { skillApi } from '@/api/skillApi'
import { getAppTransport } from '@/api/transports/appTransport'

interface SkillState { data: SkillIndex, loading: boolean }

type SkillAction
  = | { type: 'FETCH_START' }
    | { type: 'FETCH_SUCCESS', data: SkillIndex }
    | { type: 'FETCH_ERROR', error: string }

function skillReducer(state: SkillState, action: SkillAction): SkillState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true }
    case 'FETCH_SUCCESS':
      return { loading: false, data: action.data }
    case 'FETCH_ERROR':
      return { ...state, loading: false }
  }
}

export default function SkillManage() {
  const [nativeFilePicker, setNativeFilePicker] = React.useState(false)
  const [state, dispatch] = React.useReducer(skillReducer, {
    data: { rootPath: '', skills: [] },
    loading: false,
  })

  React.useEffect(() => {
    void getAppTransport().then(transport => setNativeFilePicker(transport.capabilities.nativeFilePicker))
  }, [])
  const [githubOpen, setGithubOpen] = React.useState(false)
  const [githubUrl, setGithubUrl] = React.useState('')

  const refresh = React.useCallback(async () => {
    dispatch({ type: 'FETCH_START' })
    try {
      dispatch({ type: 'FETCH_SUCCESS', data: await skillApi.listSkills() })
    }
    catch (error) {
      toast.error((error as Error).message || '加载 Skill 失败')
      dispatch({ type: 'FETCH_ERROR', error: (error as Error).message || '加载 Skill 失败' })
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  async function runAction(action: () => Promise<unknown>, success: string) {
    dispatch({ type: 'FETCH_START' })
    try {
      await action()
      toast.success(success)
      await refresh()
    }
    catch (error) {
      toast.error((error as Error).message || '操作失败')
      dispatch({ type: 'FETCH_ERROR', error: (error as Error).message || '操作失败' })
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Skills</CardTitle>
          <CardDescription>
            {state.data.rootPath || 'Loading...'}
          </CardDescription>
          <CardAction className="flex gap-2">
            <Button
              variant="outline"
              disabled={state.loading}
              onClick={() => void runAction(async () => skillApi.rebuildSkillIndex(), '索引已重建')}
            >
              <RefreshCwIcon data-icon="inline-start" />
              Rebuild
            </Button>
            {nativeFilePicker && (
              <Button
                variant="outline"
                disabled={state.loading}
                onClick={() => void runAction(async () => skillApi.importSkillFromZip(), 'ZIP 已导入')}
              >
                <ArchiveIcon data-icon="inline-start" />
                Import ZIP
              </Button>
            )}
            <Button disabled={state.loading} onClick={() => setGithubOpen(true)}>
              <GitBranchIcon data-icon="inline-start" />
              Import GitHub
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      <div className="flex flex-col gap-3">
        {state.data.skills.length === 0
          ? (
              <Card>
                <CardContent className="py-8 text-center text-gray-400">
                  No skills installed.
                </CardContent>
              </Card>
            )
          : state.data.skills.map(skill => (
              <SkillRow
                key={skill.name}
                skill={skill}
                disabled={state.loading}
                onToggle={enabled => void runAction(
                  async () => skillApi.setSkillEnabled({ name: skill.name, enabled }),
                  enabled ? 'Skill 已启用' : 'Skill 已停用',
                )}
                onDelete={() => void runAction(async () => skillApi.deleteSkill(skill.name), 'Skill 已删除')}
              />
            ))}
      </div>

      <Dialog open={githubOpen} onOpenChange={setGithubOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from GitHub</DialogTitle>
            <DialogDescription>
              Enter a GitHub repository URL or tree URL that contains SKILL.md.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={githubUrl}
            placeholder="https://github.com/openai/skills/tree/main/skills/.curated/example"
            onChange={event => setGithubUrl(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setGithubOpen(false)}>Cancel</Button>
            <Button
              disabled={!githubUrl.trim() || state.loading}
              onClick={() => {
                const url = githubUrl.trim()
                void runAction(async () => {
                  await skillApi.importSkillFromGithub({ url })
                  setGithubUrl('')
                  setGithubOpen(false)
                }, 'GitHub Skill 已导入')
              }}
            >
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SkillRow({
  skill,
  disabled,
  onToggle,
  onDelete,
}: {
  skill: SkillManifest
  disabled: boolean
  onToggle: (enabled: boolean) => void
  onDelete: () => void
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <span className="truncate">{skill.name}</span>
          <Badge variant={skill.enabled ? 'secondary' : 'outline'}>
            {skill.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <Badge variant="outline">{skill.source}</Badge>
        </CardTitle>
        <CardDescription>
          {skill.description || 'No description.'}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Switch
            checked={skill.enabled}
            disabled={disabled || skill.builtin}
            onCheckedChange={onToggle}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled || skill.builtin}
            onClick={onDelete}
          >
            <Trash2Icon />
            <span className="sr-only">Delete</span>
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  )
}
