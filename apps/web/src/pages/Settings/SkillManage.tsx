import type { GithubSkillPreview, SkillIndex, SkillManifest, SkillSource } from '@ant-chat/shared'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import { Input } from '@workspace/ui/components/input'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTrigger } from '@workspace/ui/components/popover'
import { Spinner } from '@workspace/ui/components/spinner'
import { Switch } from '@workspace/ui/components/switch'
import { ArchiveIcon, ChevronRightIcon, FileArchiveIcon, GitBranchIcon, PackagePlusIcon, RefreshCwIcon, Trash2Icon, XIcon } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { skillApi } from '@/api/skillApi'
import { SettingsPageLayout } from './SettingsPageLayout'

interface SkillState { data: SkillIndex, loading: boolean }

const SKILL_SOURCE_LABELS: Record<SkillSource, string> = {
  zip: 'ZIP',
  github: 'GitHub',
  builtin: '内置',
  local: '本地',
}

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

  const [zipImportOpen, setZipImportOpen] = React.useState(false)
  const [githubImportOpen, setGithubImportOpen] = React.useState(false)

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
          <DropdownMenu>
            <DropdownMenuTrigger render={(
              <Button disabled={state.loading}>
                <PackagePlusIcon data-icon="inline-start" className="size-3.5" />
                导入 Skill
              </Button>
            )}
            />
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setZipImportOpen(true)}>
                  <ArchiveIcon data-icon="inline-start" className="size-3.5" />
                  ZIP 文件
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setGithubImportOpen(true)}>
                  <GitBranchIcon data-icon="inline-start" className="size-3.5" />
                  GitHub 仓库
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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

      <ZipImportDialog
        open={zipImportOpen}
        onOpenChange={setZipImportOpen}
        onImported={refresh}
      />
      <GithubImportDialog
        open={githubImportOpen}
        onOpenChange={setGithubImportOpen}
        onImported={refresh}
      />
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
          <Badge variant="outline">{SKILL_SOURCE_LABELS[skill.source]}</Badge>
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

function ZipImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<void>
}) {
  const [zipFile, setZipFile] = React.useState<File | null>(null)
  const [importing, setImporting] = React.useState(false)

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
    if (!zipFile || importing) {
      return
    }
    setImporting(true)
    try {
      const zipBase64 = await fileToBase64(zipFile)
      await skillApi.importSkill({ source: 'zip', zipBase64 })
      toast.success('ZIP 已导入')
      setZipFile(null)
      onOpenChange(false)
      await onImported()
    }
    catch (error) {
      toast.error((error as Error).message || '导入失败')
    }
    finally {
      setImporting(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setZipFile(null)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="*:min-w-0 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>从 ZIP 文件导入</DialogTitle>
          <DialogDescription>
            上传本地 ZIP 压缩包导入 Skill。
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-2.5">
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
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!zipFile || importing}
            onClick={() => void importFromZip()}
          >
            导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GithubImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<void>
}) {
  const [githubUrl, setGithubUrl] = React.useState('')
  const [githubPreview, setGithubPreview] = React.useState<GithubSkillPreview[] | null>(null)
  const [githubFilter, setGithubFilter] = React.useState('')
  const [selectedPaths, setSelectedPaths] = React.useState<string[]>([])
  const [collapsedCategories, setCollapsedCategories] = React.useState<Set<string>>(() => new Set())
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [importing, setImporting] = React.useState(false)

  async function previewGithubSkills() {
    const url = githubUrl.trim()
    if (!url || previewLoading) {
      return
    }
    setPreviewLoading(true)
    try {
      const previews = await skillApi.previewGithubSkills(url)
      setGithubPreview(previews)
      setGithubFilter('')
      setSelectedPaths(previews.map(item => item.path))
    }
    catch (error) {
      toast.error((error as Error).message || '预览失败')
    }
    finally {
      setPreviewLoading(false)
    }
  }

  function togglePath(path: string, checked: boolean) {
    setSelectedPaths(prev => checked ? [...prev, path] : prev.filter(item => item !== path))
  }

  function toggleAllPaths() {
    if (!githubPreview) {
      return
    }
    setSelectedPaths(prev => prev.length === githubPreview.length ? [] : githubPreview.map(item => item.path))
  }

  const githubGroups = React.useMemo(() => {
    const keyword = githubFilter.trim().toLowerCase()
    const groups = new Map<string, GithubSkillPreview[]>()
    for (const item of githubPreview ?? []) {
      if (
        keyword
        && !item.name.toLowerCase().includes(keyword)
        && !item.description.toLowerCase().includes(keyword)
      ) {
        continue
      }
      const category = item.category ?? '仓库根目录'
      groups.set(category, [...(groups.get(category) ?? []), item])
    }
    return [...groups.entries()]
  }, [githubPreview, githubFilter])

  function toggleCategory(category: string, checked: boolean) {
    const group = githubGroups.find(([name]) => name === category)
    if (!group) {
      return
    }
    const paths = group[1].map(item => item.path)
    setSelectedPaths((prev) => {
      const without = prev.filter(path => !paths.includes(path))
      return checked ? [...without, ...paths] : without
    })
  }

  function toggleCategoryCollapsed(category: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      }
      else {
        next.add(category)
      }
      return next
    })
  }

  async function importFromGithub() {
    const url = githubUrl.trim()
    if (!githubPreview || selectedPaths.length === 0 || importing) {
      return
    }
    setImporting(true)
    try {
      const result = await skillApi.importGithubSkills(url, selectedPaths)
      if (result.installed.length > 0) {
        toast.success(`已导入 ${result.installed.length} 个 Skill`)
      }
      if (result.skipped.length > 0) {
        toast.warning(`${result.skipped.length} 个 Skill 已存在或目录无效，已跳过`)
      }
      if (result.installed.length === 0) {
        toast.error('没有 Skill 被导入')
      }
      onOpenChange(false)
      await onImported()
    }
    catch (error) {
      toast.error((error as Error).message || '导入失败')
    }
    finally {
      setImporting(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setGithubUrl('')
      setGithubPreview(null)
      setGithubFilter('')
      setSelectedPaths([])
      setCollapsedCategories(new Set())
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="*:min-w-0 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>从 GitHub 仓库导入</DialogTitle>
          <DialogDescription>
            输入仓库地址，预览并勾选要导入的 Skill。
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex gap-2">
            <Input
              className="flex-1"
              value={githubUrl}
              placeholder="https://github.com/openai/skills"
              onChange={event => setGithubUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void previewGithubSkills()
                }
              }}
            />
            <Button
              variant="outline"
              className="min-w-24"
              disabled={!githubUrl.trim() || previewLoading}
              onClick={() => void previewGithubSkills()}
            >
              {previewLoading
                ? (
                    <>
                      <Spinner className="size-3.5" />
                      扫描中
                    </>
                  )
                : '预览'}
            </Button>
          </div>
          {githubPreview && (
            githubPreview.length === 0
              ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    未在仓库根或 skills/ 目录发现 SKILL.md
                  </p>
                )
              : (
                  <div className="flex min-w-0 animate-in flex-col gap-1.5 duration-200 fade-in-0 slide-in-from-top-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {`发现 ${githubPreview.length} 个 Skill`}
                      </span>
                      <button type="button" className="text-primary hover:underline" onClick={toggleAllPaths}>
                        {selectedPaths.length === githubPreview.length ? '清空' : '全选'}
                      </button>
                    </div>
                    <Input
                      value={githubFilter}
                      placeholder="按名称或描述过滤"
                      onChange={event => setGithubFilter(event.target.value)}
                      className="h-8"
                    />
                    <div className="h-[45vh] w-full overflow-y-auto rounded-lg border">
                      {githubGroups.map(([category, items]) => (
                        <div key={category}>
                          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-foreground"
                              onClick={() => toggleCategoryCollapsed(category)}
                            >
                              <ChevronRightIcon className={`size-3.5 shrink-0 transition-transform ${collapsedCategories.has(category) ? '' : 'rotate-90'}`} />
                              <span className="truncate">{category}</span>
                              <span className="shrink-0 text-muted-foreground/70">
                                {`${items.filter(item => selectedPaths.includes(item.path)).length}/${items.length}`}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="shrink-0 text-primary hover:underline"
                              onClick={() => toggleCategory(
                                category,
                                items.some(item => !selectedPaths.includes(item.path)),
                              )}
                            >
                              {items.every(item => selectedPaths.includes(item.path)) ? '清空' : '全选'}
                            </button>
                          </div>
                          <div
                            className="grid min-h-0 overflow-hidden transition-[grid-template-rows] duration-200 ease-out"
                            style={{ gridTemplateRows: collapsedCategories.has(category) ? '0fr' : '1fr' }}
                          >
                            <div className="min-h-0 overflow-hidden">
                              {items.map((item, index) => (
                                <label
                                  key={item.path}
                                  className="flex animate-in cursor-pointer items-start gap-2.5 px-2.5 py-2 duration-200 fade-in-0 fill-mode-both slide-in-from-top-1 hover:bg-accent/50"
                                  style={{ animationDelay: `${Math.min(index, 12) * 18}ms` }}
                                >
                                  <Checkbox
                                    className="mt-0.5"
                                    checked={selectedPaths.includes(item.path)}
                                    onCheckedChange={checked => togglePath(item.path, Boolean(checked))}
                                  />
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm/5 font-medium">{item.name}</span>
                                    <span className="line-clamp-3 text-xs/4 text-muted-foreground">
                                      {item.description}
                                    </span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!githubPreview || selectedPaths.length === 0 || previewLoading || importing}
            onClick={() => void importFromGithub()}
          >
            {selectedPaths.length > 0 ? `导入选中（${selectedPaths.length}）` : '导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
