import type { CommandInterpreter, ToolApprovalRule, ToolApprovalRuleInput } from '@ant-chat/shared'
import { ToolApprovalRuleInputSchema } from '@ant-chat/shared'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@workspace/ui/components/field'
import { Input } from '@workspace/ui/components/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/components/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@workspace/ui/components/sheet'
import { Spinner } from '@workspace/ui/components/spinner'
import { Textarea } from '@workspace/ui/components/textarea'
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import permissionsApi from '@/api/permissionsApi'
import { WorkspaceDirectoryPickerDialog } from '@/components/Workspace/WorkspaceDirectoryPickerDialog'
import { useWorkspaceStore } from '@/store/workspace'
import { SettingsPageLayout } from './SettingsPageLayout'

interface PermissionData {
  global: ToolApprovalRule[]
  workspaces: Record<string, ToolApprovalRule[]>
}

type RuleScope = 'workspace' | 'global'
type RuleKind = ToolApprovalRule['kind']

interface RuleEditorState {
  scope: RuleScope
  workspacePath: string
  kind: RuleKind
  effect: 'allow' | 'deny'
  interpreter: CommandInterpreter
  executable: string
  argvText: string
  allowRemainingArgs: boolean
  resourceScope: 'workspace' | 'outside'
  access: 'read' | 'write'
  targetType: 'file' | 'directory'
  canonicalPath: string
  serverName: string
  toolName: string
  /** browser 规则的 URL 模式 */
  urlPattern: string
}

interface EditingRule {
  rule: ToolApprovalRule
  scope: RuleScope
  workspacePath?: string
}

const EMPTY_DATA: PermissionData = { global: [], workspaces: {} }

/** Select 组件的值到中文展示标签的映射 */
const selectLabels: Record<string, string> = {
  'command': '命令',
  'filesystem': '文件系统',
  'mcp-tool': 'MCP 工具',
  'browser': '浏览器',
  'allow': '允许：命中后跳过审批',
  'deny': '黑名单：命中后直接阻止',
  'global': '全局',
  'file': '精确文件',
  'directory': '目录递归读取',
  'read': '读取',
  'write': '写入',
}

export function PermissionsPage() {
  const [data, setData] = useState<PermissionData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [operationError, setOperationError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<EditingRule | null>(null)
  const [editorSession, setEditorSession] = useState(0)
  const workspaceData = useWorkspaceStore(state => state.workspaceData)
  const refreshWorkspaces = useWorkspaceStore(state => state.refresh)
  const workspacePaths = useMemo(
    () => workspaceData?.workspaces.map(workspace => workspace.path) ?? [],
    [workspaceData],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setData(await permissionsApi.list())
    }
    catch (error) {
      setLoadError(error instanceof Error ? error.message : '加载权限规则失败')
    }
    finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 如果工作区数据未加载，主动触发刷新
  useEffect(() => {
    if (!workspaceData) {
      void refreshWorkspaces()
    }
  }, [workspaceData, refreshWorkspaces])

  function openAddEditor() {
    setEditing(null)
    setEditorSession(session => session + 1)
    setEditorOpen(true)
  }

  function openEditEditor(rule: ToolApprovalRule, scope: RuleScope, workspacePath?: string) {
    setEditing({ rule, scope, workspacePath })
    setEditorSession(session => session + 1)
    setEditorOpen(true)
  }

  async function handleSave(ruleInput: ToolApprovalRuleInput, scope: RuleScope, workspacePath?: string) {
    const savedRule = editing
      ? await permissionsApi.update({
          ruleId: editing.rule.id,
          scope: editing.scope,
          workspacePath: editing.workspacePath,
          rule: ruleInput,
        })
      : await permissionsApi.add({ scope, workspacePath, rule: ruleInput })

    setData(current => editing
      ? replaceRule(current, editing.scope, editing.workspacePath, savedRule)
      : appendRule(current, scope, workspacePath, savedRule))
    toast.success(editing ? '已更新规则' : '已添加规则')
  }

  async function handleDelete(rule: ToolApprovalRule, scope: RuleScope, workspacePath?: string) {
    setOperationError('')
    try {
      await permissionsApi.remove({ ruleId: rule.id, scope, workspacePath })
      setData(current => removeRule(current, scope, workspacePath, rule.id))
      toast.success('已删除规则')
    }
    catch (error) {
      setOperationError(error instanceof Error ? error.message : '删除规则失败')
    }
  }

  async function handleClear(scope: RuleScope, workspacePath?: string) {
    setOperationError('')
    try {
      await permissionsApi.clear({ scope, workspacePath })
      setData(current => clearRuleGroup(current, scope, workspacePath))
      toast.success('已清空规则')
    }
    catch (error) {
      setOperationError(error instanceof Error ? error.message : '清空规则失败')
    }
  }

  const registeredWorkspacePaths = new Set(workspacePaths)
  const orphanedWorkspaces = Object.keys(data.workspaces).filter(path => !registeredWorkspacePaths.has(path))
  const ruleCount = data.global.length + Object.values(data.workspaces).reduce((count, rules) => count + rules.length, 0)

  return (
    <SettingsPageLayout
      title="权限"
      description="管理 Agent 工具规则。允许规则可跳过审批；黑名单规则命中后会直接阻止该次调用。"
      variant="wide"
    >
      <Button className="flex items-center self-start" onClick={openAddEditor}>
        <Plus data-icon="inline-start size-3" />
        添加规则
      </Button>

      {loading && <div className="flex items-center justify-center py-4"><Spinner /></div>}

      {!loading && loadError && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>权限规则加载失败</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>重试加载</Button>
          </AlertDescription>
        </Alert>
      )}

      {!loading && !loadError && (
        <>
          {operationError && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>权限操作失败</AlertTitle>
              <AlertDescription>{operationError}</AlertDescription>
            </Alert>
          )}

          {data.global.length > 0 && (
            <RuleGroup
              title="全局规则"
              description="可被当前和未来添加的所有工作区使用"
              rules={data.global}
              onEdit={rule => openEditEditor(rule, 'global')}
              onDelete={rule => void handleDelete(rule, 'global')}
              onClear={() => void handleClear('global')}
            />
          )}

          {Object.entries(data.workspaces).map(([workspacePath, rules]) => rules.length > 0 && (
            <RuleGroup
              key={workspacePath}
              title={workspacePath.split('/').pop() || workspacePath}
              description={registeredWorkspacePaths.has(workspacePath) ? workspacePath : `${workspacePath}（未添加的工作区）`}
              rules={rules}
              onEdit={rule => openEditEditor(rule, 'workspace', workspacePath)}
              onDelete={rule => void handleDelete(rule, 'workspace', workspacePath)}
              onClear={() => void handleClear('workspace', workspacePath)}
            />
          ))}

          {orphanedWorkspaces.length > 0 && (
            <p className="text-xs text-muted-foreground">
              未添加工作区的规则会继续保留；重新添加同一路径后自动恢复生效。
            </p>
          )}

          {ruleCount === 0 && (
            <EmptyState
              title="暂无权限规则"
              description="可以在这里主动添加，或在 Agent 审批时明确选择记住授权。"
            />
          )}
        </>
      )}

      <RuleEditorDialog
        key={editorSession}
        open={editorOpen}
        editing={editing}
        workspacePaths={workspacePaths}
        onOpenChange={setEditorOpen}
        onSave={handleSave}
      />
    </SettingsPageLayout>
  )
}

function RuleGroup({
  title,
  description,
  rules,
  onEdit,
  onDelete,
  onClear,
}: {
  title: string
  description?: string
  rules: ToolApprovalRule[]
  onEdit: (rule: ToolApprovalRule) => void
  onDelete: (rule: ToolApprovalRule) => void
  onClear: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        <CardAction>
          <Button size="xs" variant="ghost" aria-label={`清空${title}`} onClick={onClear}>
            清空
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rules.map(rule => (
          <RuleRow
            key={rule.id}
            rule={rule}
            onEdit={() => onEdit(rule)}
            onDelete={() => onDelete(rule)}
          />
        ))}
      </CardContent>
    </Card>
  )
}

function RuleRow({ rule, onEdit, onDelete }: { rule: ToolApprovalRule, onEdit: () => void, onDelete: () => void }) {
  const label = getRuleLabel(rule)

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant="secondary">{getRuleTypeLabel(rule.kind)}</Badge>
        <Badge variant={rule.effect === 'deny' ? 'destructive' : 'outline'}>{rule.effect === 'deny' ? '黑名单' : '允许'}</Badge>
        <span className="truncate font-mono">{label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="icon-xs" variant="ghost" aria-label={`编辑规则：${label}`} onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label={`删除规则：${label}`} onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

const kindOptions = [
  { value: 'command', label: '命令' },
  { value: 'filesystem', label: '文件系统' },
  { value: 'mcp-tool', label: 'MCP 工具' },
  { value: 'browser', label: '浏览器' },
]

function RuleEditorDialog({
  open,
  editing,
  workspacePaths,
  onOpenChange,
  onSave,
}: {
  open: boolean
  editing: EditingRule | null
  workspacePaths: string[]
  onOpenChange: (open: boolean) => void
  onSave: (rule: ToolApprovalRuleInput, scope: RuleScope, workspacePath?: string) => Promise<void>
}) {
  const [form, setForm] = useState<RuleEditorState>(() => createEditorState(editing, workspacePaths[0]))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [wholeExecutableConfirmOpen, setWholeExecutableConfirmOpen] = useState(false)
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false)
  const wholeExecutable = form.kind === 'command'
    && parseArgv(form.argvText).length === 0
    && form.allowRemainingArgs

  function updateForm(patch: Partial<RuleEditorState>) {
    setForm(current => ({ ...current, ...patch }))
    setError('')
    setWholeExecutableConfirmOpen(false)
  }

  async function handleSubmit(wholeExecutableConfirmed = false) {
    const validationError = validateEditor(form)
    if (validationError) {
      setError(validationError)
      return
    }
    if (wholeExecutable && !wholeExecutableConfirmed) {
      setWholeExecutableConfirmOpen(true)
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const workspacePath = form.scope === 'workspace' ? form.workspacePath : undefined
      await onSave(buildRuleInput(form), form.scope, workspacePath)
      setSubmitting(false)
      setWholeExecutableConfirmOpen(false)
      onOpenChange(false)
    }
    catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存规则失败')
      setSubmitting(false)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" showCloseButton={!submitting} className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{editing ? '编辑权限规则' : '添加权限规则'}</SheetTitle>
            <SheetDescription>
              只填写结构化能力边界。规则身份和时间由后端生成，不支持原始 JSON 或 glob。
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-3">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="permission-rule-kind">规则类型</FieldLabel>
                <Select
                  value={form.kind}
                  disabled={Boolean(editing)}
                  onValueChange={value => updateForm({ kind: value as RuleKind })}
                  items={kindOptions}
                >
                  <SelectTrigger id="permission-rule-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {
                      kindOptions.map(item => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))
                    }
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="permission-rule-effect">规则效果</FieldLabel>
                <Select
                  value={form.effect}
                  onValueChange={value => updateForm({ effect: value as 'allow' | 'deny' })}
                >
                  <SelectTrigger id="permission-rule-effect" className="w-full">
                    <SelectValue>
                      {value => (value ? selectLabels[value as string] ?? value : null)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allow">允许：命中后跳过审批</SelectItem>
                    <SelectItem value="deny">黑名单：命中后直接阻止</SelectItem>
                  </SelectContent>
                </Select>
                {form.effect === 'deny' && (
                  <FieldDescription>黑名单优先于所有允许规则，不会中断后续 Agent 对话。</FieldDescription>
                )}
              </Field>

              <Field>
                <FieldLabel htmlFor="permission-rule-scope">生效范围</FieldLabel>
                <FieldDescription>控制该规则在哪些工作区中生效。</FieldDescription>
                <Select
                  value={form.scope === 'global' ? 'global' : form.workspacePath}
                  disabled={Boolean(editing)}
                  onValueChange={(value) => {
                    if (!value || value === 'global') {
                      updateForm({ scope: 'global', workspacePath: '' })
                    }
                    else {
                      updateForm({ scope: 'workspace', workspacePath: value })
                    }
                  }}
                >
                  <SelectTrigger id="permission-rule-scope" className="w-full">
                    <SelectValue placeholder="选择生效范围">
                      {value => (value ? (value === 'global' ? '全局' : value) : null)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">全局 · 对所有工作区生效</SelectItem>
                    {workspacePaths.map(path => <SelectItem key={path} value={path}>{path}</SelectItem>)}
                    {editing?.workspacePath && editing.scope === 'workspace' && !workspacePaths.includes(editing.workspacePath) && (
                      <SelectItem value={editing.workspacePath}>
                        {editing.workspacePath}
                        （未添加）
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </Field>

              {form.kind === 'command' && (
                <>
                  <Field>
                    <FieldContent>
                      <FieldLabel htmlFor="permission-executable">命令</FieldLabel>
                      <FieldDescription>
                        解释器由系统自动检测，当前为 Bash。可直接填写 PATH 中的命令名，例如 git、node；也可以填写绝对路径。
                      </FieldDescription>
                    </FieldContent>
                    <Input
                      id="permission-executable"
                      value={form.executable}
                      placeholder="git"
                      onChange={event => updateForm({ executable: event.target.value })}
                    />
                  </Field>

                  <Field>
                    <FieldContent>
                      <FieldLabel htmlFor="permission-argv-prefix">固定参数</FieldLabel>
                      <FieldDescription>
                        每行一个参数，所有固定参数都必须出现且顺序一致。留空并允许追加任意参数时表示允许该命令使用任意参数。
                      </FieldDescription>
                    </FieldContent>
                    <Textarea
                      id="permission-argv-prefix"
                      value={form.argvText}
                      placeholder={'show\nHEAD'}
                      onChange={event => updateForm({ argvText: event.target.value })}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="permission-resource-scope">资源范围</FieldLabel>
                    <FieldDescription>控制该命令能否访问工作区外的文件路径。</FieldDescription>
                    <Select
                      value={form.resourceScope}
                      onValueChange={value => updateForm({ resourceScope: value as 'workspace' | 'outside' })}
                    >
                      <SelectTrigger id="permission-resource-scope" className="w-full">
                        <SelectValue>
                          {value => (value ? (value === 'workspace' ? '仅限工作区内文件' : '允许访问工作区外文件') : null)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="workspace">仅限工作区内文件</SelectItem>
                        <SelectItem value="outside">允许访问工作区外文件</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel>
                      <Checkbox
                        checked={form.allowRemainingArgs}
                        onCheckedChange={checked => updateForm({ allowRemainingArgs: Boolean(checked) })}
                      />
                      允许在固定参数后追加任意数量参数
                    </FieldLabel>
                    <FieldDescription>
                      {form.allowRemainingArgs
                        ? '固定参数必须完全一致；其后参数可以没有，也可以追加任意多个。'
                        : '仅允许参数与当前规则完全一致。'}
                    </FieldDescription>
                  </Field>

                  {wholeExecutable && (
                    <Alert variant="destructive">
                      <AlertTriangle />
                      <AlertTitle>命令任意参数授权</AlertTitle>
                      <AlertDescription>保存时需要在独立步骤确认允许该命令使用任意参数运行。</AlertDescription>
                    </Alert>
                  )}
                </>
              )}

              {form.kind === 'filesystem' && (
                <>
                  <Field>
                    <FieldLabel htmlFor="permission-target-type">目标类型</FieldLabel>
                    <Select
                      value={form.targetType}
                      onValueChange={(value) => {
                        const targetType = value as 'file' | 'directory'
                        updateForm({ targetType, access: targetType === 'directory' ? 'read' : form.access })
                      }}
                    >
                      <SelectTrigger id="permission-target-type" className="w-full">
                        <SelectValue>
                          {value => (value ? selectLabels[value as string] ?? value : null)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="file">精确文件</SelectItem>
                        <SelectItem value="directory">目录递归读取</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="permission-access">访问能力</FieldLabel>
                    <Select
                      value={form.targetType === 'directory' ? 'read' : form.access}
                      disabled={form.targetType === 'directory'}
                      onValueChange={value => updateForm({ access: value as 'read' | 'write' })}
                    >
                      <SelectTrigger id="permission-access" className="w-full">
                        <SelectValue>
                          {value => (value ? selectLabels[value as string] ?? value : null)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="read">读取</SelectItem>
                        <SelectItem value="write">写入</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="permission-canonical-path">文件或目录路径</FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id="permission-canonical-path"
                        value={form.canonicalPath}
                        placeholder="/workspace/app/docs"
                        readOnly={form.targetType === 'directory'}
                        onChange={event => updateForm({ canonicalPath: event.target.value })}
                      />
                      {form.targetType === 'directory' && (
                        <Button type="button" variant="outline" onClick={() => setDirectoryPickerOpen(true)}>
                          选择目录
                        </Button>
                      )}
                    </div>
                    {form.targetType === 'directory' && (
                      <FieldDescription>目录规则固定为递归读取；不支持目录写入。</FieldDescription>
                    )}
                  </Field>
                </>
              )}

              {form.kind === 'mcp-tool' && (
                <>
                  <Field>
                    <FieldLabel htmlFor="permission-mcp-server">MCP 服务器名称</FieldLabel>
                    <Input
                      id="permission-mcp-server"
                      value={form.serverName}
                      onChange={event => updateForm({ serverName: event.target.value })}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="permission-mcp-tool">MCP 工具名称</FieldLabel>
                    <Input
                      id="permission-mcp-tool"
                      value={form.toolName}
                      onChange={event => updateForm({ toolName: event.target.value })}
                    />
                  </Field>

                  <FieldDescription>保存后会允许该服务器工具使用任意输入参数。</FieldDescription>
                </>
              )}

              {form.kind === 'browser' && (
                <>
                  <Field>
                    <FieldLabel htmlFor="permission-browser-tool">浏览器工具名称</FieldLabel>
                    <Input
                      id="permission-browser-tool"
                      value={form.toolName}
                      placeholder="browser_navigate"
                      onChange={event => updateForm({ toolName: event.target.value })}
                    />
                  </Field>

                  <Field>
                    <FieldContent>
                      <FieldLabel htmlFor="permission-browser-url-pattern">限制域名</FieldLabel>
                      <FieldDescription>
                        仅 browser_navigate 使用；留空表示允许该工具访问任意域名。可使用 *.github.com 匹配子域名。
                      </FieldDescription>
                    </FieldContent>
                    <Input
                      id="permission-browser-url-pattern"
                      value={form.urlPattern}
                      placeholder="github.com"
                      onChange={event => updateForm({ urlPattern: event.target.value })}
                    />
                  </Field>
                </>
              )}
            </FieldGroup>

            {error && !wholeExecutableConfirmOpen && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>规则未保存</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <SheetFooter>
            <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button>
            <Button disabled={submitting} onClick={() => void handleSubmit()}>
              {submitting ? '保存中…' : error ? '重试保存' : '保存规则'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <WorkspaceDirectoryPickerDialog
        open={directoryPickerOpen}
        onOpenChange={setDirectoryPickerOpen}
        onConfirm={(directoryPath) => {
          updateForm({ canonicalPath: directoryPath })
          setDirectoryPickerOpen(false)
        }}
        title="选择权限目录"
        description="选择目录后，规则会递归覆盖其中的读取操作。"
        confirmLabel="选择此目录"
        allowCreateDirectory={false}
      />

      <Dialog open={wholeExecutableConfirmOpen} onOpenChange={setWholeExecutableConfirmOpen}>
        <DialogContent showCloseButton={!submitting}>
          <DialogHeader>
            <DialogTitle>确认允许命令使用任意参数</DialogTitle>
            <DialogDescription>
              这会允许命令
              {' '}
              <code>{form.executable.trim()}</code>
              {' '}
              使用任意参数运行，范围明显大于固定命令。确认后才会保存规则。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>规则未保存</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={submitting}
              onClick={() => setWholeExecutableConfirmOpen(false)}
            >
              返回修改
            </Button>
            <Button
              variant="destructive"
              disabled={submitting}
              onClick={() => void handleSubmit(true)}
            >
              {submitting ? '保存中…' : error ? '重试确认并保存' : '确认并保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function createEditorState(editing: EditingRule | null, defaultWorkspacePath = ''): RuleEditorState {
  const base: RuleEditorState = {
    scope: editing?.scope ?? 'global',
    workspacePath: editing?.workspacePath ?? defaultWorkspacePath,
    kind: editing?.rule.kind ?? 'command',
    effect: editing?.rule.effect ?? 'allow',
    interpreter: 'bash',
    executable: '',
    argvText: '',
    allowRemainingArgs: false,
    resourceScope: 'workspace',
    access: 'read',
    targetType: 'file',
    canonicalPath: '',
    serverName: '',
    toolName: '',
    urlPattern: '',
  }

  if (!editing)
    return base

  switch (editing.rule.kind) {
    case 'command':
      return {
        ...base,
        interpreter: editing.rule.interpreter,
        executable: editing.rule.executable,
        argvText: editing.rule.argvPrefix.join('\n'),
        allowRemainingArgs: editing.rule.allowRemainingArgs,
        resourceScope: editing.rule.resourceScope,
      }
    case 'filesystem':
      return {
        ...base,
        access: editing.rule.access,
        targetType: editing.rule.targetType,
        canonicalPath: editing.rule.canonicalPath,
      }
    case 'mcp-tool':
      return {
        ...base,
        serverName: editing.rule.serverName,
        toolName: editing.rule.toolName,
      }
    case 'browser':
      return {
        ...base,
        toolName: editing.rule.toolName,
        urlPattern: editing.rule.urlPattern ?? '',
      }
  }
}

function validateEditor(form: RuleEditorState): string | null {
  // 编辑器级别的验证（scope/workspacePath 不在 ToolApprovalRuleInput 中）
  if (form.scope === 'workspace' && !form.workspacePath)
    return '请选择工作区'

  // 使用 zod schema 验证规则输入
  const result = ToolApprovalRuleInputSchema.safeParse(buildRuleInput(form))
  if (!result.success) {
    return result.error.issues[0]?.message ?? '表单验证失败'
  }
  return null
}

function buildRuleInput(form: RuleEditorState): ToolApprovalRuleInput {
  switch (form.kind) {
    case 'command':
      return {
        kind: 'command',
        effect: form.effect,
        interpreter: form.interpreter,
        executable: form.executable.trim(),
        argvPrefix: parseArgv(form.argvText),
        allowRemainingArgs: form.allowRemainingArgs,
        resourceScope: form.resourceScope,
      }
    case 'filesystem':
      return {
        kind: 'filesystem',
        effect: form.effect,
        access: form.targetType === 'directory' ? 'read' : form.access,
        targetType: form.targetType,
        canonicalPath: form.canonicalPath.trim(),
        recursive: form.targetType === 'directory',
      }
    case 'mcp-tool':
      return {
        kind: 'mcp-tool',
        effect: form.effect,
        serverName: form.serverName.trim(),
        toolName: form.toolName.trim(),
      }
    case 'browser':
      return {
        kind: 'browser',
        effect: form.effect,
        toolName: form.toolName.trim(),
        urlPattern: form.urlPattern.trim() || undefined,
      }
  }
}

function parseArgv(value: string): string[] {
  return value.split('\n').map(argument => argument.trim()).filter(Boolean)
}

function getRuleTypeLabel(kind: ToolApprovalRule['kind']): string {
  switch (kind) {
    case 'command':
      return '命令'
    case 'filesystem':
      return '文件系统'
    case 'mcp-tool':
      return 'MCP 工具'
    case 'browser':
      return '浏览器'
  }
}

function getRuleLabel(rule: ToolApprovalRule): string {
  switch (rule.kind) {
    case 'command': {
      const parts = [rule.executable, ...rule.argvPrefix]
      const suffix = rule.allowRemainingArgs ? ' [可追加任意数量参数]' : ''
      return `${getInterpreterLabel(rule.interpreter)} · ${parts.join(' ')}${suffix}`
    }
    case 'filesystem': {
      const access = rule.access === 'read' ? '读取' : '写入'
      const target = rule.targetType === 'directory' ? '目录' : '文件'
      const recursive = rule.recursive ? '（递归）' : ''
      return `${access} ${target} ${rule.canonicalPath}${recursive}`
    }
    case 'mcp-tool':
      return `${rule.serverName} → ${rule.toolName}`
    case 'browser':
      return `${rule.toolName}${rule.urlPattern ? ` (${rule.urlPattern})` : ''}`
  }
}

function getInterpreterLabel(interpreter: CommandInterpreter): string {
  switch (interpreter) {
    case 'bash': return 'Bash'
    case 'powershell7': return 'PowerShell 7'
    case 'windows-powershell': return 'Windows PowerShell'
    case 'cmd': return 'CMD'
  }
}

function appendRule(data: PermissionData, scope: RuleScope, workspacePath: string | undefined, rule: ToolApprovalRule): PermissionData {
  if (scope === 'global')
    return { ...data, global: [...data.global, rule] }
  if (!workspacePath)
    return data
  return {
    ...data,
    workspaces: {
      ...data.workspaces,
      [workspacePath]: [...(data.workspaces[workspacePath] ?? []), rule],
    },
  }
}

function replaceRule(data: PermissionData, scope: RuleScope, workspacePath: string | undefined, rule: ToolApprovalRule): PermissionData {
  if (scope === 'global')
    return { ...data, global: data.global.map(current => current.id === rule.id ? rule : current) }
  if (!workspacePath)
    return data
  return {
    ...data,
    workspaces: {
      ...data.workspaces,
      [workspacePath]: (data.workspaces[workspacePath] ?? []).map(current => current.id === rule.id ? rule : current),
    },
  }
}

function removeRule(data: PermissionData, scope: RuleScope, workspacePath: string | undefined, ruleId: string): PermissionData {
  if (scope === 'global')
    return { ...data, global: data.global.filter(rule => rule.id !== ruleId) }
  if (!workspacePath)
    return data
  return {
    ...data,
    workspaces: {
      ...data.workspaces,
      [workspacePath]: (data.workspaces[workspacePath] ?? []).filter(rule => rule.id !== ruleId),
    },
  }
}

function clearRuleGroup(data: PermissionData, scope: RuleScope, workspacePath: string | undefined): PermissionData {
  if (scope === 'global')
    return { ...data, global: [] }
  if (!workspacePath)
    return data
  const workspaces = { ...data.workspaces }
  delete workspaces[workspacePath]
  return { ...data, workspaces }
}
