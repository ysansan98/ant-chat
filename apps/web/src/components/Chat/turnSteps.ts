import type { IMessage, ToolCallContent, ToolResultContent } from '@ant-chat/shared'
import type { VisualizationBlockLike } from '../Visualization/types'
import { isVisualizationBlock } from '../Visualization/types'
import { getToolCategory, TOOL_CATEGORY_SUMMARY } from './toolDisplay'

// ---- step 类型 ----

export interface ToolRunToolItem {
  kind: 'tool'
  id: string
  toolCall: ToolCallContent
  toolResult?: ToolResultContent
  isExecuting: boolean
}

export interface ToolRunReasoningItem {
  kind: 'reasoning'
  id: string
  content: string
  isStreaming: boolean
}

export type ToolRunItem = ToolRunToolItem | ToolRunReasoningItem

export type TurnStep
  = | { type: 'tool-run', id: string, items: ToolRunItem[], isExecuting: boolean, hasError: boolean }
    | { type: 'reasoning', id: string, content: string, isStreaming: boolean }
    | { type: 'text', id: string, text: string, status: IMessage['status'] }
    | { type: 'visualization', id: string, block: VisualizationBlockLike, convId: string, messageId: string }
    | { type: 'error-block', id: string, error: string, messageStatus: IMessage['status'] }
    | { type: 'steering', id: string, message: IMessage }

export type ToolRunStep = Extract<TurnStep, { type: 'tool-run' }>

/** 与 MessageBubble 一致的 toolCallId → tool 消息索引 */
export function buildToolResultMap(messages: IMessage[]): Map<string, IMessage> {
  const map = new Map<string, IMessage>()
  for (const message of messages) {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      continue
    }
    for (const block of message.content) {
      if (block.type === 'tool-result') {
        map.set(block.toolCallId, message)
      }
    }
  }
  return map
}

function findToolResult(toolResultMap: Map<string, IMessage>, toolCallId: string): ToolResultContent | undefined {
  const message = toolResultMap.get(toolCallId)
  if (!message || !Array.isArray(message.content)) {
    return undefined
  }
  return message.content.find(
    (block): block is ToolResultContent => block.type === 'tool-result',
  )
}

function isStreamingStatus(message: IMessage): boolean {
  return message.status === 'loading' || message.status === 'typing'
}

/**
 * 把一个 turn 的全部响应消息拍平成按时间序的 step 流。
 *
 * 合并规则：
 * - 连续 tool-call 合并为 tool-run，允许跨 assistant 消息；
 *   `role:'tool'` 的结果消息不可见，不阻断 run
 * - reasoning 不阻断 run：已有 run 时直接并入；尚无 run 时延迟归属，遇到工具则并入组内，
 *   只有遇到阻断或 turn 结束仍无工具时才独立成 step
 * - text / visualization / error / steering 阻断 run
 */
export function buildTurnSteps(messages: IMessage[], toolResultMap: Map<string, IMessage>): TurnStep[] {
  const steps: TurnStep[] = []
  let openRun: ToolRunStep | null = null
  let pendingReasoning: ToolRunReasoningItem[] = []

  // 经访问器读取，避免 TS 无法跨闭包追踪赋值导致的窄化失真
  const getOpenRun = () => openRun

  function flushPendingReasoningAsSteps() {
    for (const reasoning of pendingReasoning) {
      steps.push({
        type: 'reasoning',
        id: reasoning.id,
        content: reasoning.content,
        isStreaming: reasoning.isStreaming,
      })
    }
    pendingReasoning = []
  }

  function pushToolCall(block: ToolCallContent) {
    const toolResult = findToolResult(toolResultMap, block.toolCallId)
    const item: ToolRunToolItem = {
      kind: 'tool',
      id: block.toolCallId,
      toolCall: block,
      toolResult,
      isExecuting: block.executeState === 'executing' || (!toolResult && block.executeState !== 'completed'),
    }
    let run = getOpenRun()
    if (!run) {
      run = { type: 'tool-run', id: `run:${block.toolCallId}`, items: [], isExecuting: false, hasError: false }
      steps.push(run)
      openRun = run
      run.items.push(...pendingReasoning)
      pendingReasoning = []
    }
    run.items.push(item)
  }

  let textIndex = 0
  let visualizationIndex = 0
  let errorIndex = 0

  for (const message of messages) {
    if (message.role === 'tool' || message.role === 'event') {
      continue
    }

    if (message.role === 'user') {
      openRun = null
      flushPendingReasoningAsSteps()
      steps.push({ type: 'steering', id: `steering:${message.id}`, message })
      continue
    }

    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      continue
    }

    if (message.reasoningContent) {
      const reasoning: ToolRunReasoningItem = {
        kind: 'reasoning',
        id: `${message.id}:reasoning`,
        content: message.reasoningContent,
        isStreaming: isStreamingStatus(message),
      }
      const run = getOpenRun()
      if (run) {
        run.items.push(reasoning)
      }
      else {
        // reasoning 位于 assistant content 之前；延迟到遇到工具或阻断时再决定归属，
        // 才能在不改消息模型的前提下保持真实时间序。
        pendingReasoning.push(reasoning)
      }
    }

    for (const block of message.content) {
      if (block.type === 'tool-call') {
        pushToolCall(block)
        continue
      }

      openRun = null
      flushPendingReasoningAsSteps()
      if (isVisualizationBlock(block)) {
        steps.push({
          type: 'visualization',
          id: `${message.id}:visualization:${visualizationIndex++}`,
          block,
          convId: message.convId,
          messageId: message.id,
        })
      }
      else if (block.type === 'text') {
        steps.push({
          type: 'text',
          id: `${message.id}:text:${textIndex++}`,
          text: block.text,
          status: message.status,
        })
      }
      else if (block.type === 'error') {
        steps.push({
          type: 'error-block',
          id: `${message.id}:error:${errorIndex++}`,
          error: block.error,
          messageStatus: message.status,
        })
      }
    }
  }

  flushPendingReasoningAsSteps()

  for (const step of steps) {
    if (step.type === 'tool-run') {
      const tools = step.items.filter((item): item is ToolRunToolItem => item.kind === 'tool')
      step.isExecuting = tools.some(tool => tool.isExecuting)
      step.hasError = tools.some(tool => tool.toolResult?.isError)
    }
  }

  return steps
}

/** run 闭合后的 header 汇总：按类别计数，固定顺序，0 次省略 */
export function summarizeToolRun(run: ToolRunStep): string {
  const counts = new Map<string, number>()
  for (const item of run.items) {
    if (item.kind !== 'tool') {
      continue
    }
    const category = getToolCategory(item.toolCall)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return TOOL_CATEGORY_SUMMARY
    .filter(({ category }) => counts.has(category))
    .map(({ category, format }) => format(counts.get(category)!))
    .join(' · ')
}

/** run 中最后一个工具调用（执行中 header 展示的对象） */
export function getLastToolItem(run: ToolRunStep): ToolRunToolItem | undefined {
  for (let index = run.items.length - 1; index >= 0; index--) {
    const item = run.items[index]
    if (item.kind === 'tool') {
      return item
    }
  }
  return undefined
}

/** run 是否只包含一个工具调用（此时不包外层面板，直接渲染单面板） */
export function isSingleToolRun(run: ToolRunStep): boolean {
  return run.items.length === 1 && run.items[0].kind === 'tool'
}
