import type { AgentPendingAction, ApprovalCandidate, ApprovalCandidateSelection } from '@ant-chat/shared'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Badge } from '@workspace/ui/components/badge'
import { Button } from '@workspace/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/card'
import { Checkbox } from '@workspace/ui/components/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Label } from '@workspace/ui/components/label'
import { RadioGroup, RadioGroupItem } from '@workspace/ui/components/radio-group'
import { AlertTriangle } from 'lucide-react'
import { useMemo, useState } from 'react'

const scopeLabels: Record<string, string> = {
  workspace: '工作区内',
  outside: '跨工作区',
  external: '外部服务',
  blocked: '已拦截',
}

const typeLabels: Record<string, string> = {
  read: '读取',
  write: '写入',
  command: '命令',
  command_read: '只读命令',
  browser: '浏览器',
  skill: '技能',
  mcp: 'MCP 工具',
}

interface CandidateState {
  selected: boolean
  wholeExecutable: boolean
  allowRemainingArgs: boolean
  parentDirectory: boolean
  argvPrefixLength: number
  /** browser 候选：调整后的 urlPattern */
  adjustedUrlPattern?: string
}

interface AgentApprovalCardProps {
  pending: AgentPendingAction
  onApprove: (selection?: ApprovePendingActionSelection) => Promise<void>
  onReject: () => void
}

export default function AgentApprovalCard(props: AgentApprovalCardProps) {
  return <AgentApprovalCardContent key={props.pending.actionId} {...props} />
}

function AgentApprovalCardContent({
  pending,
  onApprove,
  onReject,
}: AgentApprovalCardProps) {
  const [candidateStates, setCandidateStates] = useState<Record<number, CandidateState>>({})
  const [scope, setScope] = useState<'workspace' | 'global'>('workspace')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [wholeExecutableConfirmOpen, setWholeExecutableConfirmOpen] = useState(false)

  const candidates = useMemo(
    () => pending.approvalCandidates?.candidates ?? [],
    [pending.approvalCandidates?.candidates],
  )
  const hasCandidates = candidates.length > 0

  const toggleCandidate = (index: number) => {
    setCandidateStates((prev) => {
      const current = prev[index] ?? createCandidateState(candidates[index])
      return { ...prev, [index]: { ...current, selected: !current.selected } }
    })
    setSubmitError('')
  }

  const updateCandidate = (index: number, patch: Partial<CandidateState>) => {
    setCandidateStates((prev) => {
      const current = prev[index] ?? createCandidateState(candidates[index])
      return { ...prev, [index]: { ...current, ...patch } }
    })
    setSubmitError('')
  }

  const selectedSelections = useMemo(() => {
    return Object.entries(candidateStates)
      .filter(([, state]) => state.selected)
      .map(([indexStr, state]) => {
        const candidateIndex = Number(indexStr)
        const candidate = candidates[candidateIndex]
        const selection: ApprovalCandidateSelection = { candidateIndex }
        if (candidate?.type === 'command-segment') {
          if (state.wholeExecutable) {
            selection.wholeExecutable = true
            selection.adjustedArgvPrefix = []
            selection.allowRemainingArgs = true
          }
          else {
            selection.adjustedArgvPrefix = candidate.argvPrefix.slice(0, state.argvPrefixLength)
            selection.allowRemainingArgs = state.allowRemainingArgs
          }
        }
        if (candidate?.type === 'filesystem') {
          if (state.parentDirectory) {
            selection.parentDirectory = true
          }
        }
        if (candidate?.type === 'browser') {
          if (state.adjustedUrlPattern !== undefined) {
            selection.adjustedUrlPattern = state.adjustedUrlPattern
          }
        }
        return selection
      })
  }, [candidateStates, candidates])

  const wholeExecutableCommands = Object.entries(candidateStates)
    .filter(([, state]) => state.selected && state.wholeExecutable)
    .map(([index]) => candidates[Number(index)])
    .filter((candidate): candidate is Extract<ApprovalCandidate, { type: 'command-segment' }> => candidate?.type === 'command-segment')
    .map(candidate => candidate.executable)

  const submitApproval = async () => {
    if (submitting)
      return
    setSubmitting(true)
    setSubmitError('')
    try {
      if (selectedSelections.length > 0) {
        await onApprove({ selections: selectedSelections, scope })
      }
      else {
        await onApprove(undefined)
      }
    }
    catch (error) {
      setSubmitError(error instanceof Error ? error.message : '审批失败，请重试')
      setSubmitting(false)
    }
  }

  const handleApprove = () => {
    if (selectedSelections.some(selection => selection.wholeExecutable)) {
      setWholeExecutableConfirmOpen(true)
      return
    }
    void submitApproval()
  }

  const scopeLabel = scopeLabels[pending.scope] || pending.scope
  const typeLabel = typeLabels[pending.operationType] || pending.operationType

  const showRemember = hasCandidates

  return (
    <Card size="sm" className="text-xs" data-testid="agent-approval-card">
      <CardHeader>
        <CardTitle className="gap-1 text-xs">
          审批请求：
          {pending.toolName}
          <Badge variant="secondary">{typeLabel}</Badge>
          {pending.scope !== 'workspace' && (
            <Badge variant="outline">{scopeLabel}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="break-all text-muted-foreground">
        {pending.inputPreview}
      </CardContent>

      {showRemember && (
        <div className="flex flex-col gap-2 px-3 pb-2">
          {candidates.map((candidate, index) => (
            <CandidateSelector
              key={getCandidateKey(candidate)}
              index={index}
              candidate={candidate}
              state={candidateStates[index] ?? createCandidateState(candidate)}
              onToggle={() => toggleCandidate(index)}
              onChange={patch => updateCandidate(index, patch)}
            />
          ))}

          {selectedSelections.length > 0 && (
            <div className="flex flex-col gap-2 border-t pt-2">
              <Label className="text-xs text-muted-foreground">生效范围</Label>
              <RadioGroup
                value={scope}
                onValueChange={val => setScope(val as 'workspace' | 'global')}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="scope-workspace" value="workspace" />
                  <Label htmlFor="scope-workspace" className="cursor-pointer text-xs">当前工作区</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="scope-global" value="global" />
                  <Label htmlFor="scope-global" className="cursor-pointer text-xs">全局</Label>
                </div>
              </RadioGroup>
            </div>
          )}
        </div>
      )}

      {submitError && !wholeExecutableConfirmOpen && (
        <Alert variant="destructive" className="mx-3 mb-2 w-auto">
          <AlertTriangle />
          <AlertTitle>审批未提交</AlertTitle>
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2 px-3 pb-3">
        <Button
          size="xs"
          data-testid="agent-approve"
          disabled={submitting}
          onClick={handleApprove}
        >
          {submitting ? '提交中…' : submitError ? '重试批准' : selectedSelections.length > 0 ? '批准并记住' : '仅本次批准'}
        </Button>
        <Button
          size="xs"
          variant="destructive"
          disabled={submitting}
          onClick={onReject}
          data-testid="agent-reject"
        >
          拒绝
        </Button>
      </div>

      <Dialog open={wholeExecutableConfirmOpen} onOpenChange={setWholeExecutableConfirmOpen}>
        <DialogContent showCloseButton={!submitting}>
          <DialogHeader>
            <DialogTitle>确认允许命令使用任意参数</DialogTitle>
            <DialogDescription>
              这会允许命令
              {' '}
              <code>{wholeExecutableCommands.join('、')}</code>
              {' '}
              使用任意参数运行。该范围明显大于当前命令，只应在你信任此程序及其所有参数行为时保存。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {submitError && (
              <Alert variant="destructive" className="mb-2 w-full sm:mr-auto">
                <AlertTriangle />
                <AlertTitle>授权未提交</AlertTitle>
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}
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
              onClick={() => void submitApproval()}
            >
              {submitting ? '提交中…' : submitError ? '重试确认授权' : '确认授权'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function CandidateSelector({
  index,
  candidate,
  state,
  onToggle,
  onChange,
}: {
  index: number
  candidate: ApprovalCandidate
  state: CandidateState
  onToggle: () => void
  onChange: (patch: Partial<CandidateState>) => void
}) {
  if (candidate.type === 'command-segment') {
    const candidateId = `candidate-command-${index}`
    return (
      <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={candidateId}
            checked={state.selected}
            onCheckedChange={() => onToggle()}
          />
          <Label htmlFor={candidateId} className="cursor-pointer font-mono text-xs">
            记住命令
            {' '}
            {candidate.displayCommand}
            {' · '}
            {getInterpreterLabel(candidate.interpreter)}
          </Label>
        </div>
        {state.selected && (
          <div className="ml-6 flex flex-col gap-2">
            {candidate.argvPrefix.length > 0 && !state.wholeExecutable && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                固定参数边界
                <select
                  aria-label="固定参数边界"
                  className="h-8 rounded-md border border-input bg-background px-2 font-mono text-foreground"
                  value={state.argvPrefixLength}
                  onChange={(event) => {
                    const argvPrefixLength = Number(event.target.value)
                    onChange({
                      argvPrefixLength,
                      allowRemainingArgs: argvPrefixLength < candidate.argvPrefix.length,
                    })
                  }}
                >
                  {candidate.argvPrefix.map((_, prefixIndex) => {
                    const length = prefixIndex + 1
                    return (
                      <option key={length} value={length}>
                        {candidate.argvPrefix.slice(0, length).join(' ')}
                      </option>
                    )
                  })}
                </select>
              </label>
            )}
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Checkbox
                checked={state.allowRemainingArgs}
                disabled={state.wholeExecutable || state.argvPrefixLength < candidate.argvPrefix.length}
                onCheckedChange={val => onChange({ allowRemainingArgs: Boolean(val) })}
              />
              允许在固定参数后追加任意数量参数
            </label>
            {!state.wholeExecutable && (
              <div aria-label="最终授权范围" className="rounded-md border bg-background px-2 py-1.5 text-xs text-muted-foreground">
                {state.allowRemainingArgs
                  ? '以上固定参数必须完全一致；其后参数可以没有，也可以追加任意多个。'
                  : '仅允许参数与当前命令完全一致'}
              </div>
            )}
            {candidate.canWholeExecutable && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Checkbox
                  checked={state.wholeExecutable}
                  onCheckedChange={(val) => {
                    onChange({
                      wholeExecutable: Boolean(val),
                      allowRemainingArgs: val
                        ? true
                        : state.argvPrefixLength < candidate.argvPrefix.length,
                    })
                  }}
                />
                允许该命令使用任意参数（范围较大）
              </label>
            )}
            {state.wholeExecutable && (
              <div className="flex items-center gap-1 text-xs text-orange-500">
                <AlertTriangle />
                提交时还需独立确认该高风险授权
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (candidate.type === 'filesystem') {
    const candidateId = `candidate-filesystem-${index}`
    return (
      <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={candidateId}
            checked={state.selected}
            onCheckedChange={() => onToggle()}
          />
          <Label htmlFor={candidateId} className="cursor-pointer font-mono text-xs">
            记住
            {' '}
            {candidate.access === 'write' ? '写入' : '读取'}
            {' '}
            {candidate.displayPath}
          </Label>
        </div>
        {state.selected && candidate.canParentDirectory && (
          <div className="ml-6">
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Checkbox
                checked={state.parentDirectory}
                onCheckedChange={val => onChange({ parentDirectory: Boolean(val) })}
              />
              改为授权父目录递归读取
            </label>
          </div>
        )}
      </div>
    )
  }

  if (candidate.type === 'mcp-tool') {
    const candidateId = `candidate-mcp-${index}`
    return (
      <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={candidateId}
            checked={state.selected}
            onCheckedChange={() => onToggle()}
          />
          <Label htmlFor={candidateId} className="cursor-pointer text-xs">
            记住此 MCP 工具（任意参数）
          </Label>
        </div>
        {state.selected && (
          <div className="ml-6 flex items-center gap-1 text-xs text-orange-500">
            <AlertTriangle />
            {candidate.riskWarning}
          </div>
        )}
      </div>
    )
  }

  if (candidate.type === 'browser') {
    const candidateId = `candidate-browser-${index}`
    return (
      <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={candidateId}
            checked={state.selected}
            onCheckedChange={() => onToggle()}
          />
          <Label htmlFor={candidateId} className="cursor-pointer text-xs">
            记住此浏览器工具（
            {candidate.toolName}
            {candidate.urlPattern ? ` · ${candidate.urlPattern}` : ''}
            ）
          </Label>
        </div>
        {state.selected && (
          <div className="ml-6 flex flex-col gap-1">
            {candidate.urlPattern && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                限制域名
                <input
                  type="text"
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  value={state.adjustedUrlPattern ?? candidate.urlPattern}
                  onChange={(event) => {
                    onChange({ adjustedUrlPattern: event.target.value })
                  }}
                  placeholder={candidate.urlPattern}
                />
              </label>
            )}
            <div className="flex items-center gap-1 text-xs text-orange-500">
              <AlertTriangle />
              {candidate.riskWarning}
            </div>
          </div>
        )}
      </div>
    )
  }

  return null
}

function createCandidateState(candidate: ApprovalCandidate | undefined): CandidateState {
  return {
    selected: false,
    wholeExecutable: false,
    allowRemainingArgs: false,
    parentDirectory: false,
    argvPrefixLength: candidate?.type === 'command-segment' ? candidate.argvPrefix.length : 0,
  }
}

function getCandidateKey(candidate: ApprovalCandidate): string {
  switch (candidate.type) {
    case 'command-segment':
      return `command-${candidate.interpreter}-${candidate.segmentIndex}-${candidate.executable}`
    case 'filesystem':
      return `filesystem-${candidate.access}-${candidate.canonicalPath}`
    case 'mcp-tool':
      return `mcp-${candidate.serverName}-${candidate.toolName}`
    case 'browser':
      return `browser-${candidate.toolName}-${candidate.urlPattern ?? ''}`
  }
}

function getInterpreterLabel(interpreter: string): string {
  switch (interpreter) {
    case 'bash': return 'Bash'
    case 'powershell7': return 'PowerShell 7'
    case 'windows-powershell': return 'Windows PowerShell'
    case 'cmd': return 'CMD'
    default: return interpreter
  }
}

interface ApprovePendingActionSelection {
  selections: ApprovalCandidateSelection[]
  scope: 'workspace' | 'global'
}
