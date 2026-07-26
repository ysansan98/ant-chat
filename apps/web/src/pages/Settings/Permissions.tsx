import type { ToolApprovalRule, ToolApprovalRuleInput } from '@ant-chat/shared'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Input } from '@workspace/ui/components/input'
import { Label } from '@workspace/ui/components/label'
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
  executable: string
  argvText: string
  allowRemainingArgs: boolean
  resourceScope: 'workspace' | 'outside'
  access: 'read' | 'write'
  targetType: 'file' | 'directory'
  canonicalPath: string
  serverName: string
  toolName: string
}

interface EditingRule {
  rule: ToolApprovalRule
  scope: RuleScope
  workspacePath?: string
}

const EMPTY_DATA: PermissionData = { global: [], workspaces: {} }
const selectClassName = 'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground'

export function PermissionsPage() {
  const [data, setData] = useState<PermissionData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [operationError, setOperationError] = useState('')
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<EditingRule | null>(null)
  const [editorSession, setEditorSession] = useState(0)
  const workspaceData = useWorkspaceStore(state => state.workspaceData)
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
      <Button className="self-start" onClick={openAddEditor}>
        <Plus data-icon="inline-start" />
        添加规则
      </Button>

      {loading && <div role="status" className="text-sm text-muted-foreground">正在加载权限规则…</div>}

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
  const wholeExecutable = form.kind === 'bash-command'
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg" showCloseButton={!submitting}>
          <DialogHeader>
            <DialogTitle>{editing ? '编辑权限规则' : '添加权限规则'}</DialogTitle>
            <DialogDescription>
              只填写结构化能力边界。规则身份和时间由后端生成，不支持原始 JSON 或 glob。
            </DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
            <FormField label="规则类型" htmlFor="permission-rule-kind">
              <select
                id="permission-rule-kind"
                className={selectClassName}
                value={form.kind}
                disabled={Boolean(editing)}
                onChange={event => updateForm({ kind: event.target.value as RuleKind })}
              >
                <option value="bash-command">Bash 命令</option>
                <option value="filesystem">文件系统</option>
                <option value="mcp-tool">MCP 工具</option>
              </select>
            </FormField>

            <FormField label="规则效果" htmlFor="permission-rule-effect">
              <select
                id="permission-rule-effect"
                className={selectClassName}
                value={form.effect}
                onChange={event => updateForm({ effect: event.target.value as 'allow' | 'deny' })}
              >
                <option value="allow">允许：命中后跳过审批</option>
                <option value="deny">黑名单：命中后直接阻止</option>
              </select>
              {form.effect === 'deny' && <p className="text-xs text-muted-foreground">黑名单优先于所有允许规则，不会中断后续 Agent 对话。</p>}
            </FormField>

            <FormField label="生效分组" htmlFor="permission-rule-scope">
              <select
                id="permission-rule-scope"
                className={selectClassName}
                value={form.scope}
                disabled={Boolean(editing)}
                onChange={event => updateForm({ scope: event.target.value as RuleScope })}
              >
                <option value="global">全局</option>
                <option value="workspace">指定工作区</option>
              </select>
            </FormField>

            {form.scope === 'workspace' && (
              <FormField label="工作区路径" htmlFor="permission-workspace-path">
                <select
                  id="permission-workspace-path"
                  className={selectClassName}
                  value={form.workspacePath}
                  disabled={Boolean(editing)}
                  onChange={event => updateForm({ workspacePath: event.target.value })}
                >
                  {workspacePaths.length === 0 && <option value="">暂无工作区</option>}
                  {workspacePaths.map(path => <option key={path} value={path}>{path}</option>)}
                  {editing?.workspacePath && !workspacePaths.includes(editing.workspacePath) && (
                    <option value={editing.workspacePath}>
                      {editing.workspacePath}
                      （未添加）
                    </option>
                  )}
                </select>
              </FormField>
            )}

            {form.kind === 'bash-command' && (
              <>
                <FormField
                  label="命令"
                  htmlFor="permission-executable"
                  description="可直接填写 PATH 中的命令名，例如 git、node；也可以填写绝对路径。"
                >
                  <Input
                    id="permission-executable"
                    value={form.executable}
                    placeholder="git"
                    onChange={event => updateForm({ executable: event.target.value })}
                  />
                </FormField>
                <FormField
                  label="固定参数"
                  htmlFor="permission-argv-prefix"
                  description="每行一个参数，所有固定参数都必须出现且顺序一致。留空并允许追加任意参数时表示允许该命令使用任意参数。"
                >
                  <Textarea
                    id="permission-argv-prefix"
                    value={form.argvText}
                    placeholder={'show\nHEAD'}
                    onChange={event => updateForm({ argvText: event.target.value })}
                  />
                </FormField>
                <FormField label="资源范围" htmlFor="permission-resource-scope">
                  <select
                    id="permission-resource-scope"
                    className={selectClassName}
                    value={form.resourceScope}
                    onChange={event => updateForm({ resourceScope: event.target.value as 'workspace' | 'outside' })}
                  >
                    <option value="workspace">当前工作区路径参数</option>
                    <option value="outside">工作区外路径参数</option>
                  </select>
                </FormField>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.allowRemainingArgs}
                    onCheckedChange={checked => updateForm({ allowRemainingArgs: Boolean(checked) })}
                  />
                  允许在固定参数后追加任意数量参数
                </label>
                <p className="text-xs text-muted-foreground">
                  {form.allowRemainingArgs
                    ? '固定参数必须完全一致；其后参数可以没有，也可以追加任意多个。'
                    : '仅允许参数与当前规则完全一致。'}
                </p>
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
                <FormField label="目标类型" htmlFor="permission-target-type">
                  <select
                    id="permission-target-type"
                    className={selectClassName}
                    value={form.targetType}
                    onChange={(event) => {
                      const targetType = event.target.value as 'file' | 'directory'
                      updateForm({ targetType, access: targetType === 'directory' ? 'read' : form.access })
                    }}
                  >
                    <option value="file">精确文件</option>
                    <option value="directory">目录递归读取</option>
                  </select>
                </FormField>
                <FormField label="访问能力" htmlFor="permission-access">
                  <select
                    id="permission-access"
                    className={selectClassName}
                    value={form.targetType === 'directory' ? 'read' : form.access}
                    disabled={form.targetType === 'directory'}
                    onChange={event => updateForm({ access: event.target.value as 'read' | 'write' })}
                  >
                    <option value="read">读取</option>
                    <option value="write">写入</option>
                  </select>
                </FormField>
                <FormField label="文件或目录路径" htmlFor="permission-canonical-path">
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
                </FormField>
                {form.targetType === 'directory' && (
                  <p className="text-xs text-muted-foreground">目录规则固定为递归读取；不支持目录写入。</p>
                )}
              </>
            )}

            {form.kind === 'mcp-tool' && (
              <>
                <FormField label="MCP 服务器名称" htmlFor="permission-mcp-server">
                  <Input
                    id="permission-mcp-server"
                    value={form.serverName}
                    onChange={event => updateForm({ serverName: event.target.value })}
                  />
                </FormField>
                <FormField label="MCP 工具名称" htmlFor="permission-mcp-tool">
                  <Input
                    id="permission-mcp-tool"
                    value={form.toolName}
                    onChange={event => updateForm({ toolName: event.target.value })}
                  />
                </FormField>
                <p className="text-xs text-muted-foreground">保存后会允许该服务器工具使用任意输入参数。</p>
              </>
            )}

            {error && !wholeExecutableConfirmOpen && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>规则未保存</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button>
            <Button disabled={submitting} onClick={() => void handleSubmit()}>
              {submitting ? '保存中…' : error ? '重试保存' : '保存规则'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function FormField({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string
  htmlFor: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}

function createEditorState(editing: EditingRule | null, defaultWorkspacePath = ''): RuleEditorState {
  const base: RuleEditorState = {
    scope: editing?.scope ?? 'global',
    workspacePath: editing?.workspacePath ?? defaultWorkspacePath,
    kind: editing?.rule.kind ?? 'bash-command',
    effect: editing?.rule.effect ?? 'allow',
    executable: '',
    argvText: '',
    allowRemainingArgs: false,
    resourceScope: 'workspace',
    access: 'read',
    targetType: 'file',
    canonicalPath: '',
    serverName: '',
    toolName: '',
  }

  if (!editing)
    return base

  switch (editing.rule.kind) {
    case 'bash-command':
      return {
        ...base,
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
  }
}

function validateEditor(form: RuleEditorState): string | null {
  if (form.scope === 'workspace' && !form.workspacePath)
    return '请选择工作区'
  if (form.kind === 'bash-command' && !form.executable.trim())
    return '请输入命令'
  if (form.kind === 'filesystem' && !form.canonicalPath.trim())
    return '请输入文件或目录路径'
  if (form.kind === 'mcp-tool' && (!form.serverName.trim() || !form.toolName.trim()))
    return '请输入 MCP 服务器名称和工具名称'
  return null
}

function buildRuleInput(form: RuleEditorState): ToolApprovalRuleInput {
  switch (form.kind) {
    case 'bash-command':
      return {
        kind: 'bash-command',
        effect: form.effect,
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
  }
}

function parseArgv(value: string): string[] {
  return value.split('\n').map(argument => argument.trim()).filter(Boolean)
}

function getRuleTypeLabel(kind: ToolApprovalRule['kind']): string {
  switch (kind) {
    case 'bash-command':
      return 'Bash 命令'
    case 'filesystem':
      return '文件系统'
    case 'mcp-tool':
      return 'MCP 工具'
  }
}

function getRuleLabel(rule: ToolApprovalRule): string {
  switch (rule.kind) {
    case 'bash-command': {
      const parts = [rule.executable, ...rule.argvPrefix]
      const suffix = rule.allowRemainingArgs ? ' [可追加任意数量参数]' : ''
      return `${parts.join(' ')}${suffix}`
    }
    case 'filesystem': {
      const access = rule.access === 'read' ? '读取' : '写入'
      const target = rule.targetType === 'directory' ? '目录' : '文件'
      const recursive = rule.recursive ? '（递归）' : ''
      return `${access} ${target} ${rule.canonicalPath}${recursive}`
    }
    case 'mcp-tool':
      return `${rule.serverName} → ${rule.toolName}`
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
