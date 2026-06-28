import type { IMessage, ToolCallContent, ToolResultContent } from '@ant-chat/shared'
import { CodeBlock } from '@workspace/ui/components/ai-elements/code-block'
import { MessageResponse } from '@workspace/ui/components/ai-elements/message'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import { cn } from '@workspace/ui/lib/utils'
import {
  BrainIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  Loader2Icon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { isNetworkError } from '@/utils/networkError'

// ---- step types ----

interface ToolStepData {
  id: string
  toolCall: ToolCallContent
  toolResult?: ToolResultContent
  isExecuting: boolean
}

type ContentStep
  = | { type: 'reasoning', id: string, content: string, isStreaming: boolean }
    | { type: 'tool', id: string, toolCall: ToolCallContent, toolResult?: ToolResultContent, isExecuting: boolean }
    | { type: 'tool-group', id: string, tools: ToolStepData[], isExecuting: boolean }
    | { type: 'text', id: string, text: string }
    | { type: 'error-block', id: string, error: string }

type TraceStep = Extract<ContentStep, { type: 'reasoning' | 'tool' | 'tool-group' }>

// ---- build steps ----

const TOOL_GROUP_THRESHOLD = 2

function buildContentSteps(
  message: IMessage,
  toolResultMap: Map<string, IMessage>,
  showReasoning: boolean,
): ContentStep[] {
  const steps: ContentStep[] = []

  // Reasoning always first, before any content block
  if (showReasoning && message.reasoningContent) {
    const isStreaming = message.status === 'loading' || message.status === 'typing'
    steps.push({
      type: 'reasoning',
      id: `${message.id}:reasoning`,
      content: message.reasoningContent,
      isStreaming,
    })
  }

  // Content blocks in original order; consecutive tool-calls grouped
  if (Array.isArray(message.content)) {
    let textIndex = 0
    let errorIndex = 0
    const pendingTools: ToolStepData[] = []

    function flushToolGroup() {
      if (pendingTools.length === 0)
        return
      if (pendingTools.length < TOOL_GROUP_THRESHOLD) {
        const t = pendingTools[0]
        steps.push({ type: 'tool', id: t.id, toolCall: t.toolCall, toolResult: t.toolResult, isExecuting: t.isExecuting })
      }
      else {
        const first = pendingTools[0]
        steps.push({
          type: 'tool-group',
          id: `tool-group:${first.id}`,
          tools: [...pendingTools],
          isExecuting: pendingTools.some(t => t.isExecuting),
        })
      }
      pendingTools.length = 0
    }

    for (const block of message.content) {
      if (block.type === 'tool-call') {
        const resultMsg = toolResultMap.get(block.toolCallId)
        const resultBlock = resultMsg?.content.find(
          (b): b is typeof b & { type: 'tool-result' } => b.type === 'tool-result',
        )
        pendingTools.push({
          id: block.toolCallId,
          toolCall: block,
          toolResult: resultBlock as ToolResultContent | undefined,
          isExecuting: block.executeState === 'executing' || (!resultBlock && block.executeState !== 'completed'),
        })
      }
      else {
        flushToolGroup()
        if (block.type === 'text') {
          steps.push({
            type: 'text',
            id: `${message.id}:text:${textIndex++}`,
            text: block.text,
          })
        }
        else if (block.type === 'error') {
          steps.push({
            type: 'error-block',
            id: `${message.id}:error:${errorIndex++}`,
            error: block.error,
          })
        }
      }
    }
    flushToolGroup()
  }

  return steps
}

function isTraceStep(step: ContentStep): step is TraceStep {
  return step.type === 'reasoning' || step.type === 'tool' || step.type === 'tool-group'
}

// ---- auto-expand/collapse ----

function useTraceAutoExpand(steps: ContentStep[]) {
  const traceSteps = useMemo(() => steps.filter(isTraceStep), [steps])

  // Collect child-tool ids so they have entries in openState
  const childToolEntries = useMemo(() => {
    const entries: { id: string, isExecuting: boolean }[] = []
    for (const step of traceSteps) {
      if (step.type === 'tool-group') {
        for (const tool of step.tools) {
          entries.push({ id: tool.id, isExecuting: tool.isExecuting })
        }
      }
    }
    return entries
  }, [traceSteps])

  const activeStepId = useMemo(() => {
    // Check child tools first (most granular), then groups, then top-level steps
    for (const e of childToolEntries) {
      if (e.isExecuting)
        return e.id
    }
    for (let i = traceSteps.length - 1; i >= 0; i--) {
      const step = traceSteps[i]
      if (step.type === 'reasoning' && step.isStreaming)
        return step.id
      if (step.type === 'tool' && step.isExecuting)
        return step.id
      if (step.type === 'tool-group' && step.isExecuting)
        return step.id
    }
    return null
  }, [traceSteps, childToolEntries])

  // User overrides: explicit open/close toggles that trump auto-behavior
  const [userOverrides, setUserOverrides] = useState<Record<string, boolean>>({})
  const openStateRef = useRef<Record<string, boolean>>({})

  // Compute open state during render — no useEffect needed
  const openState = useMemo(() => {
    const next: Record<string, boolean> = {}

    function setOpen(id: string, defaultOpen: boolean) {
      if (id in userOverrides) {
        next[id] = userOverrides[id]
      }
      else if (id === activeStepId) {
        next[id] = true
      }
      else {
        next[id] = defaultOpen
      }
    }

    for (const step of traceSteps) {
      if (step.type === 'tool-group') {
        setOpen(step.id, step.isExecuting)
        for (const tool of step.tools) {
          setOpen(tool.id, tool.isExecuting)
        }
      }
      else if (step.type === 'reasoning') {
        setOpen(step.id, step.isStreaming)
      }
      else {
        // single tool
        setOpen(step.id, step.isExecuting)
      }
    }

    openStateRef.current = next
    return next
  }, [traceSteps, activeStepId, userOverrides])

  const handleToggle = useCallback((stepId: string) => {
    const currentOpen = openStateRef.current[stepId] ?? false
    setUserOverrides(prev => ({ ...prev, [stepId]: !currentOpen }))
  }, [])

  return { openState, handleToggle, traceSteps, activeStepId }
}

// ---- sub-components ----

function CollapseChevron({ open }: { open: boolean }) {
  return (
    <ChevronDownIcon
      className={cn(
        'size-3.5 ml-auto shrink-0 opacity-0 transition-all',
        'group-hover/trace:opacity-100',
        open && 'rotate-180 opacity-100',
      )}
    />
  )
}

function ReasoningStepItem({
  step,
  open,
  onToggle,
}: {
  step: Extract<ContentStep, { type: 'reasoning' }>
  open: boolean
  onToggle: (id: string) => void
}) {
  return (
    <Collapsible open={open} onOpenChange={() => onToggle(step.id)}>
      <CollapsibleTrigger
        className={cn(
          'group/trace flex w-full items-center gap-1.5 py-1 text-sm transition-colors',
          'text-muted-foreground hover:text-foreground',
        )}
      >
        <BrainIcon className="size-3 shrink-0" />
        <span className="text-xs">
          {step.isStreaming ? 'Thinking' : 'Thought complete'}
        </span>
        {step.isStreaming && <Loader2Icon className="size-3 animate-spin" />}
        <CollapseChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn(
          'ml-4 pl-2',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1',
        )}
      >
        <div className="py-1 text-xs text-muted-foreground whitespace-pre-wrap">
          {step.content}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---- tool parameter extraction ----

/** Extract the most relevant inline parameter for the tool header. */
function getInlineParam(toolCall: ToolCallContent): string | null {
  const args = toolCall.args as Record<string, unknown> | undefined
  if (!args || typeof args !== 'object')
    return null

  switch (toolCall.toolName) {
    case 'read_file':
    case 'write_to_file':
    case 'replace_in_file':
      return typeof args.filePath === 'string'
        ? args.filePath
        : typeof args.path === 'string'
          ? args.path
          : null
    case 'search_content':
    case 'search_file':
      return typeof args.pattern === 'string'
        ? args.pattern
        : typeof args.regex === 'string'
          ? args.regex
          : null
    case 'bash':
      return typeof args.command === 'string' ? args.command : null
    default:
      return null
  }
}

// ---- compact tool header icon ----

function ToolStatusIcon({ state }: { state: 'input-available' | 'output-available' | 'output-error' }) {
  if (state === 'output-error') {
    return <XCircleIcon className="size-3 shrink-0 text-destructive" />
  }
  if (state === 'output-available') {
    return <CheckCircleIcon className="size-3 shrink-0 text-green-600" />
  }
  return <Loader2Icon className="size-3 shrink-0 animate-spin text-muted-foreground" />
}

function CompactToolItem({
  tool,
  open,
  onToggle,
}: {
  tool: ToolStepData
  open: boolean
  onToggle: (id: string) => void
}) {
  const hasResult = !!tool.toolResult
  const state = hasResult
    ? (tool.toolResult!.isError ? 'output-error' as const : 'output-available' as const)
    : 'input-available' as const
  const inlineParam = getInlineParam(tool.toolCall)

  return (
    <Collapsible open={open} onOpenChange={() => onToggle(tool.id)}>
      <CollapsibleTrigger
        className={cn(
          'group/trace flex w-full min-w-0 items-center gap-1.5 py-1 text-sm transition-colors',
          'text-muted-foreground hover:text-foreground',
        )}
      >
        <ToolStatusIcon state={state} />
        <span className="font-medium text-xs shrink-0">{tool.toolCall.toolName}</span>
        {inlineParam && (
          <span className="text-xs text-muted-foreground/60 truncate min-w-0">
            {inlineParam}
          </span>
        )}
        <CollapseChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn(
          'ml-4 pl-2 space-y-2',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1',
        )}
      >
        {tool.toolResult && (
          <div
            className={cn(
              'rounded text-xs overflow-y-auto',
              '[&_pre]:text-xs! [&_code]:text-xs!',
              tool.toolResult.isError
                ? 'text-destructive'
                : 'bg-muted/50 text-foreground',
            )}
          >
            <CodeBlock code={String(tool.toolResult.result)} language="json" className="max-h-40 overflow-y-auto mb-1" />

          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolGroupItem({
  group,
  open,
  onToggle,
  openState,
}: {
  group: Extract<ContentStep, { type: 'tool-group' }>
  open: boolean
  onToggle: (id: string) => void
  openState: Record<string, boolean>
}) {
  const toolCount = group.tools.length

  return (
    <Collapsible open={open} onOpenChange={() => onToggle(group.id)}>
      <CollapsibleTrigger
        className={cn(
          'group/trace flex w-full items-center gap-1.5 py-1 text-sm transition-colors',
          'text-muted-foreground hover:text-foreground',
        )}
      >
        {group.isExecuting
          ? <Loader2Icon className="size-3 shrink-0 animate-spin text-muted-foreground" />
          : <WrenchIcon className="size-3 shrink-0 text-muted-foreground" />}
        <span className="text-xs">
          View
          {' '}
          {toolCount}
          {' '}
          steps
        </span>
        <CollapseChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn(
          'ml-4 pl-2 space-y-1',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1',
        )}
      >
        {group.tools.map(tool => (
          <CompactToolItem
            key={tool.id}
            tool={tool}
            open={openState[tool.id] ?? !tool.toolResult}
            onToggle={onToggle}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

function TraceStepItem({
  step,
  open,
  onToggle,
  openState,
}: {
  step: TraceStep
  open: boolean
  onToggle: (stepId: string) => void
  openState: Record<string, boolean>
}) {
  if (step.type === 'reasoning') {
    return <ReasoningStepItem step={step} open={open} onToggle={onToggle} />
  }
  if (step.type === 'tool-group') {
    return <ToolGroupItem group={step} open={open} onToggle={onToggle} openState={openState} />
  }
  return (
    <CompactToolItem
      tool={{ id: step.id, toolCall: step.toolCall, toolResult: step.toolResult, isExecuting: step.isExecuting }}
      open={open}
      onToggle={onToggle}
    />
  )
}

// ---- helpers ----

function getErrorText(message: IMessage): string {
  return message.content
    .filter(b => b.type === 'error')
    .map(b => b.error)
    .join('\n')
}

function hasTextContent(message: IMessage): boolean {
  return message.content.some(b => b.type === 'text' && b.text.length > 0)
}

// ---- public component ----

interface AssistantTraceProps {
  message: IMessage
  toolResultMap: Map<string, IMessage>
  /** Whether to show reasoning step. False for visible messages whose reasoning was extracted to the fold. */
  showReasoning?: boolean
}

/**
 * Renders assistant message content in order.
 * Consecutive trace steps (reasoning / tool / tool-group) share one
 * continuous left border. Text and error blocks break the border.
 */
export function AssistantTrace({ message, toolResultMap, showReasoning = true }: AssistantTraceProps) {
  const steps = useMemo(
    () => buildContentSteps(message, toolResultMap, showReasoning),
    [message, toolResultMap, showReasoning],
  )

  const { openState, handleToggle } = useTraceAutoExpand(steps)
  const isStreaming = message.status === 'loading' || message.status === 'typing'

  // Group consecutive same-kind steps so trace items share a single left border
  const renderGroups = useMemo(() => {
    const groups: Array<{ steps: ContentStep[], isTrace: boolean }> = []
    for (const step of steps) {
      const currentIsTrace = isTraceStep(step)
      const last = groups[groups.length - 1]
      if (last && last.isTrace === currentIsTrace) {
        last.steps.push(step)
      }
      else {
        groups.push({ steps: [step], isTrace: currentIsTrace })
      }
    }
    return groups
  }, [steps])

  return (
    <div className="space-y-3">
      {renderGroups.map((group) => {
        // Consecutive trace steps: single bordered wrapper
        if (group.isTrace) {
          return (
            <div
              key={group.steps[0].id}
              className="ml-3 border-l-2 border-muted/60 pl-4 space-y-0.5"
            >
              {group.steps.map(step => (
                <TraceStepItem
                  key={step.id}
                  step={step as TraceStep}
                  open={openState[step.id] ?? false}
                  onToggle={handleToggle}
                  openState={openState}
                />
              ))}
            </div>
          )
        }

        // Non-trace steps: render inline without border
        return group.steps.map((step) => {
          if (step.type === 'text') {
            return (
              <MessageResponse key={step.id} isAnimating={isStreaming}>
                {step.text}
              </MessageResponse>
            )
          }
          if (step.type === 'error-block') {
            if (message.status === 'error') {
              return null
            }
            return (
              <p key={step.id} className="text-destructive whitespace-pre-wrap text-sm">
                {step.error}
              </p>
            )
          }
          return null
        })
      })}

      {/* Status alerts */}
      {message.status === 'error' && (
        <Alert variant="destructive">
          <XCircleIcon className="size-4" />
          <AlertTitle>
            {isNetworkError(getErrorText(message)) ? 'Connection interrupted' : 'Request failed'}
          </AlertTitle>
          <AlertDescription>
            <p className="whitespace-pre-wrap">
              {getErrorText(message) || '请求失败。请检查配置并重试。'}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {message.status === 'cancel' && !hasTextContent(message) && (
        <Alert variant="default">
          <AlertTitle>Cancelled</AlertTitle>
          <AlertDescription>
            <p>Task cancelled.</p>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
