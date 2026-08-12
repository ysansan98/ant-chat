import type { SkillIndex, SkillManifest } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTrigger } from '@workspace/ui/components/popover'
import { Spinner } from '@workspace/ui/components/spinner'
import { Switch } from '@workspace/ui/components/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@workspace/ui/components/tabs'
import { ArchiveIcon, FileArchiveIcon, GitBranchIcon, PackagePlusIcon, RefreshCwIcon, Trash2Icon, XIcon } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { skillApi } from '@/api/skillApi'
import { SettingsPageLayout } from './SettingsPageLayout'

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
  const [state, dispatch] = React.useReducer(skillReducer, {
    data: { rootPath: '', skills: [] },
    loading: false,
  })

  const [importOpen, setImportOpen] = React.useState(false)
  const [importTab, setImportTab] = React.useState<'zip' | 'github'>('github')
  const [githubUrl, setGithubUrl] = React.useState('')
  const [zipFile, setZipFile] = React.useState<File | null>(null)

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

  function selectZipFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('仅支持 .zip 文件')
      return
    }
    setZipFile(file)
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
  }

  async function importFromZip() {
    if (!zipFile) {
      return
    }
    dispatch({ type: 'FETCH_START' })
    try {
      const zipBase64 = await fileToBase64(zipFile)
      await skillApi.importSkill({ source: 'zip', zipBase64 })
      toast.success('ZIP 已导入')
      setZipFile(null)
      setImportOpen(false)
      await refresh()
    }
    catch (error) {
      toast.error((error as Error).message || '导入失败')
      dispatch({ type: 'FETCH_ERROR', error: (error as Error).message || '导入失败' })
    }
  }

  function importFromGithub() {
    const url = githubUrl.trim()
    void runAction(async () => {
      await skillApi.importSkill({ source: 'github', url })
      setGithubUrl('')
      setImportOpen(false)
    }, 'GitHub Skill 已导入')
  }

  return (
    <SettingsPageLayout
      title="Skill 设置"
      description={state.data.rootPath || (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3" />
          正在加载...
        </span>
      )}
      actions={(
        <>
          <Button
            variant="outline"
            disabled={state.loading}
            onClick={() => void runAction(async () => skillApi.rebuildSkillIndex(), '索引已重建')}
          >
            <RefreshCwIcon data-icon="inline-start" className="size-3.5" />
            重建索引
          </Button>
          <Button disabled={state.loading} onClick={() => setImportOpen(true)}>
            <PackagePlusIcon data-icon="inline-start" className="size-3.5" />
            导入 Skill
          </Button>
        </>
      )}
      variant="wide"
    >
      <div className="flex flex-col gap-3">
        {state.data.skills.length === 0
          ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  当前没有安装任何 Skill
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

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导入 Skill</DialogTitle>
            <DialogDescription>
              从本地 ZIP 文件或 GitHub 仓库导入 Skill。
            </DialogDescription>
          </DialogHeader>
          <Tabs value={importTab} onValueChange={value => setImportTab(value === 'zip' ? 'zip' : 'github')} className="transition-all">
            <TabsList className="w-full">
              <TabsTrigger value="zip">
                <ArchiveIcon data-icon="inline-start" className="size-3.5" />
                ZIP 文件
              </TabsTrigger>
              <TabsTrigger value="github">
                <GitBranchIcon data-icon="inline-start" className="size-3.5" />
                GitHub URL
              </TabsTrigger>
            </TabsList>
            <TabsContent value="zip" className="flex flex-col justify-center">
              <div className="flex flex-col gap-2.5">
                <label
                  className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors hover:bg-accent/50"
                  onDragOver={event => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    const file = event.dataTransfer.files?.[0]
                    if (file) {
                      selectZipFile(file)
                    }
                  }}
                >
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) {
                        selectZipFile(file)
                      }
                    }}
                  />
                  <ArchiveIcon className="size-8 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    点击选择或拖拽 ZIP 文件
                  </span>
                </label>
                {zipFile && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <FileArchiveIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{zipFile.name}</span>
                    </span>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="移除文件"
                      onClick={() => setZipFile(null)}
                    >
                      <XIcon className="size-4" />
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
            <TabsContent value="github">
              <div className="flex flex-col gap-2.5">
                <Input
                  value={githubUrl}
                  placeholder="https://github.com/openai/skills/tree/main/skills/.curated/example"
                  onChange={event => setGithubUrl(event.target.value)}
                />

              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              取消
            </Button>
            <Button
              disabled={
                (importTab === 'github' && !githubUrl.trim())
                || (importTab === 'zip' && !zipFile)
                || state.loading
              }
              onClick={() => {
                if (importTab === 'github') {
                  importFromGithub()
                }
                else {
                  void importFromZip()
                }
              }}
            >
              导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageLayout>
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
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2 text-base/6 font-semibold">
          <span className="truncate text-base">{skill.name}</span>
          <Badge variant="outline">{skill.source}</Badge>
        </CardTitle>
        <CardDescription className="text-pretty">
          {skill.description || 'No description.'}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Switch
            checked={skill.enabled}
            disabled={disabled || skill.builtin}
            onCheckedChange={onToggle}
          />
          <Popover open={deleteOpen} onOpenChange={setDeleteOpen}>
            <PopoverTrigger render={(
              <Button
                variant="destructive"
                size="icon-sm"
                disabled={disabled || skill.builtin}
              >
                <Trash2Icon className="size-4" />
                <span className="sr-only">
                  {`删除 ${skill.name}`}
                </span>
              </Button>
            )}
            />
            <PopoverContent align="end" className="w-60">
              <PopoverHeader>
                <PopoverDescription>
                  <span className="text-xs">
                    {`确认删除「${skill.name}」？此操作不可撤销。`}
                  </span>
                </PopoverDescription>
              </PopoverHeader>
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setDeleteOpen(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setDeleteOpen(false)
                    onDelete()
                  }}
                >
                  删除
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </CardAction>
      </CardHeader>
    </Card>
  )
}
