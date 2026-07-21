import type { IMessage, ToolCallContent } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import {
  buildToolResultMap,
  buildTurnSteps,
  getLastToolItem,
  isSingleToolRun,
  summarizeToolRun,
} from '../turnSteps'

let seq = 0

function assistant(
  content: IMessage['content'],
  opts: { status?: IMessage['status'], reasoning?: string } = {},
): IMessage {
  seq += 1
  return {
    id: `a-${seq}`,
    convId: 'conv-1',
    createdAt: seq,
    role: 'assistant',
    content,
    status: opts.status ?? 'success',
    reasoningContent: opts.reasoning,
    turnId: 'turn-1',
  }
}

function toolCall(
  toolName: string,
  args: Record<string, unknown> = {},
  state: ToolCallContent['executeState'] = 'completed',
): ToolCallContent {
  seq += 1
  return { type: 'tool-call', toolCallId: `call-${seq}`, toolName, args, executeState: state }
}

function toolResultMessage(call: ToolCallContent, result: string, isError = false): IMessage {
  seq += 1
  return {
    id: `t-${seq}`,
    convId: 'conv-1',
    createdAt: seq,
    role: 'tool',
    status: isError ? 'error' : 'success',
    content: [{
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      result,
      isError,
    }],
    turnId: 'turn-1',
  }
}

function steering(text: string): IMessage {
  seq += 1
  return {
    id: `u-${seq}`,
    convId: 'conv-1',
    createdAt: seq,
    role: 'user',
    status: 'success',
    content: [{ type: 'text', text }],
    turnId: 'turn-1',
  }
}

function stepsOf(messages: IMessage[]) {
  return buildTurnSteps(messages, buildToolResultMap(messages))
}

describe('消息步骤合并', () => {
  it('连续工具调用可跨助手消息合并，工具结果消息不可见且不阻断', () => {
    const read = toolCall('read_file', { path: 'a.ts' })
    const grep = toolCall('grep_files', { pattern: 'foo' })
    const steps = stepsOf([
      assistant([read]),
      toolResultMessage(read, 'file content'),
      assistant([grep]),
      toolResultMessage(grep, 'a.ts:1:foo'),
    ])

    expect(steps).toHaveLength(1)
    const run = steps[0]
    expect(run.type).toBe('tool-run')
    if (run.type !== 'tool-run')
      return
    expect(run.items.map(item => item.id)).toEqual([read.toolCallId, grep.toolCallId])
    expect(run.isExecuting).toBe(false)
  })

  it('思考过程不阻断已打开的工具组，并排在后续工具之前', () => {
    const read = toolCall('read_file', { path: 'a.ts' })
    const grep = toolCall('grep_files', { pattern: 'foo' })
    const steps = stepsOf([
      assistant([read]),
      toolResultMessage(read, 'file content'),
      assistant([grep], { reasoning: '再搜索引用' }),
    ])

    expect(steps.map(s => s.type)).toEqual(['tool-run'])
    const run = steps[0]
    if (run.type !== 'tool-run')
      throw new Error('预期得到工具组')
    expect(run.items.map(item => item.kind)).toEqual(['tool', 'reasoning', 'tool'])
  })

  it('助手先思考再调用工具时按时间序并入同一个工具组', () => {
    const read = toolCall('read_file', { path: 'a.ts' })
    const steps = stepsOf([
      assistant([read], { reasoning: '先定位相关文件' }),
      toolResultMessage(read, 'file content'),
    ])

    expect(steps).toHaveLength(1)
    const run = steps[0]
    if (run.type !== 'tool-run')
      throw new Error('预期得到工具 run')
    expect(run.items.map(item => item.kind)).toEqual(['reasoning', 'tool'])
  })

  it('本轮没有工具调用时思考过程独立展示', () => {
    const steps = stepsOf([
      assistant([{ type: 'text', text: '好的' }], { reasoning: '想一下' }),
    ])

    expect(steps.map(s => s.type)).toEqual(['reasoning', 'text'])
  })

  it('正文和追加指令会闭合工具组，后续工具调用进入新组', () => {
    const first = toolCall('read_file', { path: 'a.ts' })
    const second = toolCall('read_file', { path: 'b.ts' })
    const steps = stepsOf([
      assistant([first]),
      toolResultMessage(first, 'a'),
      assistant([{ type: 'text', text: '中间说明' }]),
      steering('顺便改一下'),
      assistant([second]),
      toolResultMessage(second, 'b'),
    ])

    expect(steps.map(s => s.type)).toEqual(['tool-run', 'text', 'steering', 'tool-run'])
    const [runA, , , runB] = steps
    if (runA.type !== 'tool-run' || runB.type !== 'tool-run')
      throw new Error('预期得到工具组')
    expect(runA.id).toBe(`run:${first.toolCallId}`)
    expect(runB.id).toBe(`run:${second.toolCallId}`)
  })

  it('错误内容块会闭合工具组并保留消息状态', () => {
    const call = toolCall('bash', { command: 'pnpm check' })
    const steps = stepsOf([
      assistant([call]),
      toolResultMessage(call, 'stdout:\nexitCode=0'),
      assistant([{ type: 'error', error: '模型请求失败' }], { status: 'error' }),
    ])

    expect(steps.map(s => s.type)).toEqual(['tool-run', 'error-block'])
    const errorStep = steps[1]
    if (errorStep.type !== 'error-block')
      throw new Error('预期得到错误步骤')
    expect(errorStep.messageStatus).toBe('error')
  })

  it('事件消息不出现在步骤流中', () => {
    seq += 1
    const event: IMessage = {
      id: `e-${seq}`,
      convId: 'conv-1',
      createdAt: seq,
      role: 'event',
      status: 'success',
      content: [{ type: 'text', text: '上下文已压缩' }],
      eventType: 'compaction',
      turnId: 'turn-1',
    }
    const steps = stepsOf([assistant([{ type: 'text', text: '前' }]), event])

    expect(steps.map(s => s.type)).toEqual(['text'])
  })
})

describe('工具组执行与错误状态', () => {
  it('工具正在执行或结果未到达时保持活动态，明确完成后不再视为执行中', () => {
    const executingCall = toolCall('bash', { command: 'ls' }, 'executing')
    const running = stepsOf([assistant([executingCall])])
    const runA = running[0]
    if (runA.type !== 'tool-run')
      throw new Error('预期得到工具组')
    expect(runA.isExecuting).toBe(true)

    // 流式途中 tool-call 尚未携带 executeState 且结果未到达，同样视为执行中
    const streamingCall: ToolCallContent = { type: 'tool-call', toolCallId: 'call-streaming', toolName: 'bash', args: { command: 'ls' } }
    const streaming = stepsOf([assistant([streamingCall])])
    const runB = streaming[0]
    if (runB.type !== 'tool-run')
      throw new Error('预期得到工具组')
    expect(runB.isExecuting).toBe(true)

    const settledCall = toolCall('bash', { command: 'ls' })
    const settled = stepsOf([assistant([settledCall])])
    const runC = settled[0]
    if (runC.type !== 'tool-run')
      throw new Error('预期得到工具组')
    expect(runC.isExecuting).toBe(false)
  })

  it('任一工具失败时工具组进入错误态', () => {
    const ok = toolCall('read_file', { path: 'a.ts' })
    const bad = toolCall('bash', { command: 'rm x' })
    const steps = stepsOf([
      assistant([ok, bad]),
      toolResultMessage(ok, 'a'),
      toolResultMessage(bad, 'stderr:\nboom\nexitCode=1', true),
    ])

    const run = steps[0]
    if (run.type !== 'tool-run')
      throw new Error('预期得到工具组')
    expect(run.hasError).toBe(true)
    expect(run.isExecuting).toBe(false)
  })
})

describe('工具组汇总', () => {
  it('按类别和固定顺序计数，省略零次类别与思考过程', () => {
    const calls = [
      toolCall('read_file', { path: 'a.ts' }),
      toolCall('read_file', { path: 'b.ts' }),
      toolCall('edit_file', { path: 'a.ts', edits: [] }),
      toolCall('bash', { command: 'ls' }),
      toolCall('mcp___do_thing'),
    ]
    const steps = stepsOf([
      assistant(calls, { reasoning: '计划' }),
      ...calls.map((call, index) => toolResultMessage(call, `r${index}`)),
    ])

    const run = steps.find(s => s.type === 'tool-run')
    if (run?.type !== 'tool-run')
      throw new Error('预期得到工具组')
    expect(summarizeToolRun(run)).toBe('读取 2 次 · 编辑 1 次 · 运行 1 条命令 · 调用工具 1 次')
  })
})

describe('工具组展示结构', () => {
  it('只有一个工具且没有思考过程时直接展示单工具面板', () => {
    const single = toolCall('read_file', { path: 'a.ts' })
    const steps = stepsOf([assistant([single]), toolResultMessage(single, 'a')])
    const run = steps[0]
    if (run.type !== 'tool-run')
      throw new Error('预期得到工具组')
    expect(isSingleToolRun(run)).toBe(true)
  })

  it('活动态标题使用末尾思考过程之前的最后一个工具', () => {
    const call = toolCall('bash', { command: 'ls' })
    const steps = stepsOf([
      assistant([call]),
      toolResultMessage(call, 'stdout:\nexitCode=0'),
      assistant([], { reasoning: '收尾思考' }),
    ])
    const run = steps[0]
    if (run.type !== 'tool-run')
      throw new Error('预期得到工具组')
    expect(isSingleToolRun(run)).toBe(false)
    expect(getLastToolItem(run)?.toolCall.toolCallId).toBe(call.toolCallId)
  })
})
