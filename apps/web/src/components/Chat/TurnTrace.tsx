import type { IMessage } from '@ant-chat/shared'
import type { ComponentProps } from 'react'
import type { ToolRunStep, ToolRunToolItem, TurnStep } from './turnSteps'
import { CodeBlock } from '@workspace/ui/components/ai-elements/code-block'
import { MessageResponse } from '@workspace/ui/components/ai-elements/message'
import { Shimmer } from '@workspace/ui/components/ai-elements/shimmer'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import { cn } from '@workspace/ui/lib/utils'
import {
  BrainIcon,
  ChevronDownIcon,
  TerminalIcon,
  XCircleIcon,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { formatTime } from '@/utils'
import { transformMessageContent } from '@/utils/messageTransform'
import { isNetworkError } from '@/utils/networkError'
import { VisualizationFrame } from '../Visualization/VisualizationFrame'
import MessageContent from './MessageContent'
import {
  buildCommandSessionText,
  buildEditDiff,
  getCommandLanguage,
  getLanguageFromPath,
  getToolLabel,
  splitToolName,
} from './toolDisplay'
import { buildTurnSteps, getLastToolItem, isSingleToolRun, summarizeToolRun } from './turnSteps'

// ---- 展开/收起状态 ----

/**
 * 所有折叠面板默认收起，用户手动 toggle 记为 override。
 * activeRunId 仅用于 header 展示（执行中文案 + shimmer），不影响展开状态。
 */
function useTurnTraceOpenState(steps: TurnStep[], turnRunning: boolean) {
  const activeRunId = useMemo(() => {
    for (let index = steps.length - 1; index >= 0; index--) {
      const step = steps[index]
      if (step.type === 'tool-run' && step.isExecuting) {
        return step.id
      }
    }
    // 工具已全部完成但模型仍在思考下一步时，末尾 run 仍按执行中展示
    const last = steps.at(-1)
    if (turnRunning && last?.type === 'tool-run') {
      return last.id
    }
    return null
  }, [steps, turnRunning])

  const [userOverrides, setUserOverrides] = useState<Record<string, boolean>>({})

  const handleToggle = useCallback((id: string) => {
    setUserOverrides(prev => ({ ...prev, [id]: !(prev[id] ?? false) }))
  }, [])

  return { openState: userOverrides, handleToggle, activeRunId }
}

// ---- 基础小组件 ----

function CollapseChevron({ open }: { open: boolean }) {
  return (
    <ChevronDownIcon
      className={cn(
        'ml-1 size-3.5 shrink-0 opacity-0 transition-[transform,opacity]',
        'group-hover/trace:opacity-100',
        open && 'rotate-180 opacity-100',
      )}
    />
  )
}

/** header 主文案：执行中用 shimmer 表达活动态；失败用文字标红（不带图标） */
function HeaderLabel({ text, active, error }: { text: string, active?: boolean, error?: boolean }) {
  if (active) {
    return (
      <span className="min-w-0 truncate text-xs" aria-label={`${text}，执行中`}>
        <Shimmer as="span">{text}</Shimmer>
      </span>
    )
  }
  return <span className={cn('min-w-0 truncate text-xs', error && 'text-destructive')}>{text}</span>
}

const triggerClass = cn(
  'group/trace flex w-full min-w-0 items-center gap-1.5 py-1 text-sm transition-colors',
  'text-muted-foreground hover:text-foreground',
)

const contentAnimationClass = cn(
  'data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-top-1',
  'data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-1',
)

function ReasoningItem({
  id,
  content,
  isStreaming,
  open,
  onToggle,
}: {
  id: string
  content: string
  isStreaming: boolean
  open: boolean
  onToggle: (id: string) => void
}) {
  return (
    <Collapsible open={open} onOpenChange={() => onToggle(id)}>
      <CollapsibleTrigger className={triggerClass}>
        <BrainIcon className="size-3 shrink-0" />
        {isStreaming
          ? <Shimmer as="span" className="text-xs">思考中</Shimmer>
          : <span className="text-xs">思考完成</span>}
        <CollapseChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent className={contentAnimationClass}>
        <div className="py-1 text-xs whitespace-pre-wrap text-muted-foreground">
          {content}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---- 工具展开体 ----

function toResultText(result: unknown): string | undefined {
  if (result == null) {
    return undefined
  }
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
}

type CodeBlockLanguage = ComponentProps<typeof CodeBlock>['language']

function BodyCodeBlock({ code, language }: { code: string, language: string }) {
  return (
    <CodeBlock
      code={code}
      language={language as CodeBlockLanguage}
      className="mb-1 max-h-64 overflow-y-auto [&_code]:text-xs! [&_pre]:text-xs!"
    />
  )
}

function ToolBody({ item }: { item: ToolRunToolItem }) {
  const { toolCall, toolResult } = item
  const args = (toolCall.args ?? {}) as Record<string, unknown>
  const { isMcp, shortName } = splitToolName(toolCall)
  const resultText = toResultText(toolResult?.result)

  if (!isMcp && shortName === 'execute_command' && toolCall.command) {
    // 命令执行失败也保留终端会话语义，失败态由标题文字标红表达。
    const command = typeof args.command === 'string' ? args.command : ''
    return (
      <BodyCodeBlock
        code={buildCommandSessionText(command, toolCall.command.interpreter, resultText)}
        language={getCommandLanguage(toolCall.command.interpreter)}
      />
    )
  }

  if (toolResult?.isError) {
    return (
      <div className="rounded-sm bg-destructive/10 px-2 py-1.5 text-xs whitespace-pre-wrap text-destructive">
        {resultText ?? '工具执行失败'}
      </div>
    )
  }

  if (!isMcp && shortName === 'edit_file') {
    const diff = buildEditDiff(args)
    if (diff) {
      return <BodyCodeBlock code={diff} language="diff" />
    }
  }

  if (!isMcp && shortName === 'read_file' && resultText) {
    const language = getLanguageFromPath(typeof args.path === 'string' ? args.path : '')
    return <BodyCodeBlock code={resultText} language={language} />
  }

  if (!isMcp && shortName === 'write_file') {
    const content = typeof args.content === 'string' ? args.content : resultText
    if (content) {
      const language = getLanguageFromPath(typeof args.path === 'string' ? args.path : '')
      return <BodyCodeBlock code={content} language={language} />
    }
  }

  if (resultText) {
    return <BodyCodeBlock code={resultText} language="text" />
  }
  return null
}

// ---- 工具面板（内层 / 单工具时直接渲染） ----

function ToolCallItem({
  item,
  active = false,
  open,
  onToggle,
}: {
  item: ToolRunToolItem
  active?: boolean
  open: boolean
  onToggle: (id: string) => void
}) {
  const label = getToolLabel(item.toolCall)
  const error = !!item.toolResult?.isError
  const { isMcp, shortName } = splitToolName(item.toolCall)
  const showTerminalIcon = !isMcp && shortName === 'execute_command'

  return (
    <Collapsible open={open} onOpenChange={() => onToggle(item.id)}>
      <CollapsibleTrigger className={triggerClass}>
        {showTerminalIcon && (
          <TerminalIcon role="img" aria-label="终端" className="size-3 shrink-0" />
        )}
        <HeaderLabel text={label.primary} active={active || item.isExecuting} error={error} />
        {label.diff && (
          <span className="shrink-0 text-xs tabular-nums">
            <span className="text-emerald-700 dark:text-emerald-400">
              +
              {label.diff.added}
            </span>
            {' '}
            <span className="text-destructive">
              -
              {label.diff.removed}
            </span>
          </span>
        )}
        {label.secondary && (
          <span className="shrink-0 text-xs text-muted-foreground/60">{label.secondary}</span>
        )}
        <CollapseChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent className={contentAnimationClass}>
        <ToolBody item={item} />
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---- 连续工具的外层面板 ----

function ToolRunPanel({
  run,
  active,
  open,
  openState,
  onToggle,
}: {
  run: ToolRunStep
  active: boolean
  open: boolean
  openState: Record<string, boolean>
  onToggle: (id: string) => void
}) {
  const lastTool = getLastToolItem(run)
  const header = active && lastTool
    ? getToolLabel(lastTool.toolCall).primary
    : summarizeToolRun(run)

  return (
    <Collapsible open={open} onOpenChange={() => onToggle(run.id)}>
      <CollapsibleTrigger className={triggerClass}>
        <HeaderLabel text={header} active={active} error={!active && run.hasError} />
        <CollapseChevron open={open} />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('space-y-1', contentAnimationClass)}>
        {run.items.map(item => item.kind === 'tool'
          ? (
              <ToolCallItem
                key={item.id}
                item={item}
                open={openState[item.id] ?? false}
                onToggle={onToggle}
              />
            )
          : (
              <ReasoningItem
                key={item.id}
                id={item.id}
                content={item.content}
                isStreaming={item.isStreaming}
                open={openState[item.id] ?? false}
                onToggle={onToggle}
              />
            ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---- steering（追加指令） ----

function SteeringItem({ message }: { message: IMessage }) {
  return (
    <div className="mr-1 ml-3 border-l-2 border-primary/25 py-1 pl-4" data-message-id={message.id}>
      <div className="rounded-lg bg-primary/8 px-3 py-2.5 ring-1 ring-primary/18">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-primary">追加指令</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {formatTime(message.createdAt)}
          </span>
        </div>
        <MessageContent
          content={transformMessageContent(message)}
          status={message.status as 'success' | 'loading' | 'typing'}
          enableReferenceTokens
        />
      </div>
    </div>
  )
}

export function TurnErrorAlert({ error }: { error: string }) {
  return (
    <Alert variant="destructive">
      <XCircleIcon className="size-4" />
      <AlertTitle>
        {isNetworkError(error) ? '连接已中断' : '请求失败'}
      </AlertTitle>
      <AlertDescription>
        <p className="whitespace-pre-wrap">
          {error || '请求失败。请检查配置并重试。'}
        </p>
      </AlertDescription>
    </Alert>
  )
}

// ---- 主组件 ----

interface TurnTraceProps {
  messages: IMessage[]
  toolResultMap: Map<string, IMessage>
  /** turn 仍在运行：末尾 run 的 header 按执行中展示（shimmer） */
  turnRunning?: boolean
}

/**
 * 按时间序渲染整个 turn 的 assistant 输出，连续的 trace 类 step（tool-run / reasoning）紧凑归组。
 */
export function TurnTrace({ messages, toolResultMap, turnRunning = false }: TurnTraceProps) {
  const steps = useMemo(() => buildTurnSteps(messages, toolResultMap), [messages, toolResultMap])
  const isStreaming = useMemo(
    () => messages.some(m => m.role === 'assistant' && (m.status === 'loading' || m.status === 'typing')),
    [messages],
  )
  const running = turnRunning || isStreaming
  const { openState, handleToggle, activeRunId } = useTurnTraceOpenState(steps, running)

  // 连续 trace 类 step 归为一组（仅控制间距）
  const renderGroups = useMemo(() => {
    const groups: Array<{ steps: TurnStep[], isTrace: boolean }> = []
    for (const step of steps) {
      const isTrace = step.type === 'tool-run' || step.type === 'reasoning'
      const last = groups[groups.length - 1]
      if (last && last.isTrace === isTrace) {
        last.steps.push(step)
      }
      else {
        groups.push({ steps: [step], isTrace })
      }
    }
    return groups
  }, [steps])

  function renderTraceStep(step: TurnStep) {
    if (step.type === 'reasoning') {
      return (
        <ReasoningItem
          key={step.id}
          id={step.id}
          content={step.content}
          isStreaming={step.isStreaming}
          open={openState[step.id] ?? false}
          onToggle={handleToggle}
        />
      )
    }
    if (step.type === 'tool-run') {
      if (isSingleToolRun(step)) {
        return (
          <ToolCallItem
            key={step.id}
            item={step.items[0] as ToolRunToolItem}
            active={step.id === activeRunId}
            open={openState[step.items[0].id] ?? false}
            onToggle={handleToggle}
          />
        )
      }
      return (
        <ToolRunPanel
          key={step.id}
          run={step}
          active={step.id === activeRunId}
          open={openState[step.id] ?? false}
          openState={openState}
          onToggle={handleToggle}
        />
      )
    }
    return null
  }

  function renderInlineStep(step: TurnStep) {
    switch (step.type) {
      case 'text':
        return (
          <MessageResponse key={step.id} isAnimating={isStreaming}>
            {step.text}
          </MessageResponse>
        )
      case 'visualization':
        return <VisualizationFrame key={step.id} block={step.block} conversationId={step.convId} messageId={step.messageId} />
      case 'error-block':
        return <TurnErrorAlert key={step.id} error={step.error} />
      case 'steering':
        return <SteeringItem key={step.id} message={step.message} />
      default:
        return null
    }
  }

  return (
    <div className="space-y-3">
      {renderGroups.map((group) => {
        // 连续 trace 类 step 仅用紧凑间距归组，不加缩进和边线
        if (group.isTrace) {
          return (
            <div key={group.steps[0].id} className="space-y-0.5">
              {group.steps.map(renderTraceStep)}
            </div>
          )
        }
        return group.steps.map(renderInlineStep)
      })}
    </div>
  )
}
