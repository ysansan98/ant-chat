import type { IMessage, IMessageContent, ToolCallContent } from '@ant-chat/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MessageBubble } from '../MessageBubble'

let seq = 0

function createAssistantMessage(
  id: string,
  content: IMessageContent,
  status: IMessage['status'] = 'success',
  reasoningContent?: string,
): IMessage {
  return {
    id,
    convId: 'conv-1',
    role: 'assistant',
    content,
    status,
    createdAt: 1,
    turnId: 'turn-1',
    reasoningContent,
  }
}

function createToolCall(
  toolName: string,
  args: Record<string, unknown>,
  state: ToolCallContent['executeState'] = 'completed',
): ToolCallContent {
  seq += 1
  return {
    type: 'tool-call',
    toolCallId: `call-${seq}`,
    toolName,
    args,
    executeState: state,
    ...(toolName === 'execute_command' ? { command: { interpreter: 'bash' as const } } : {}),
  }
}

function createToolResult(call: ToolCallContent, result: string, isError = false): IMessage {
  seq += 1
  return {
    id: `tool-result-${seq}`,
    convId: 'conv-1',
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      result,
      isError,
    }],
    status: isError ? 'error' : 'success',
    createdAt: 2,
    turnId: 'turn-1',
  }
}

function createSteering(text: string): IMessage {
  seq += 1
  return {
    id: `steering-${seq}`,
    convId: 'conv-1',
    role: 'user',
    content: [{ type: 'text', text }],
    status: 'success',
    createdAt: 2,
    turnId: 'turn-1',
  }
}

function renderBubble(messages: IMessage[]) {
  return render(
    <MessageBubble
      messages={messages}
      onCopyMessage={vi.fn()}
    />,
  )
}

describe('消息气泡', () => {
  it('首条助手消息内容为空时不渲染任何工具面板', () => {
    renderBubble([createAssistantMessage('pending', [], 'loading')])

    expect(screen.queryByText(/执行过程/)).not.toBeInTheDocument()
  })

  it('只有可视化内容时直接展示可视化画布', () => {
    renderBubble([createAssistantMessage('visualization', [{
      type: 'visualization',
      source: { type: 'file_id', file_id: 'viz-1' },
      format: 'ant-chat.visualization.html.v1',
      title: '阶段延迟',
      summary: '比较阶段延迟',
      size: 32,
      sha256: '0'.repeat(64),
    }], 'success')])

    expect(screen.getByRole('status')).toHaveTextContent('正在加载可视化')
  })

  it('过程性短文本与最终回答都直接内联展示，不再折叠进执行过程面板', () => {
    const read = createToolCall('read_file', { path: 'a.ts' })
    renderBubble([
      createAssistantMessage('step-1', [
        { type: 'text', text: '先看一下文件' },
        read,
      ]),
      createToolResult(read, 'file content'),
      createAssistantMessage('final', [{ type: 'text', text: '找到了问题' }]),
    ])

    expect(screen.queryByText(/执行过程/)).not.toBeInTheDocument()
    expect(screen.getByText('先看一下文件')).toBeInTheDocument()
    expect(screen.getByText('找到了问题')).toBeInTheDocument()
    expect(screen.getByText('读取 a.ts')).toBeInTheDocument()
  })

  it('单个工具调用默认收起，点击后展开结果内容', () => {
    const read = createToolCall('read_file', { path: 'README.md' })
    renderBubble([
      createAssistantMessage('tool-step', [read]),
      createToolResult(read, '已读取 README'),
      createAssistantMessage('final', [{ type: 'text', text: '完成' }]),
    ])

    expect(screen.queryByText('已读取 README')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('读取 README.md'))

    expect(screen.getByText('已读取 README')).toBeInTheDocument()
  })

  it('连续工具闭合后外层标题展示汇总，展开后可见每个工具', () => {
    const read = createToolCall('read_file', { path: 'README.md' })
    const bash = createToolCall('execute_command', { command: 'pnpm check' })
    renderBubble([
      createAssistantMessage('tool-step', [read, bash]),
      createToolResult(read, '已读取 README'),
      createToolResult(bash, 'stdout:\nok\nexitCode=0'),
      createAssistantMessage('final', [{ type: 'text', text: '完成' }]),
    ])

    expect(screen.getByText('读取 1 次 · 运行 1 条命令')).toBeInTheDocument()
    expect(screen.queryByText('读取 README.md')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('读取 1 次 · 运行 1 条命令'))

    expect(screen.getByText('读取 README.md')).toBeInTheDocument()
    expect(screen.getByText('pnpm check')).toBeInTheDocument()
  })

  it('连续工具执行中时标题展示最新工具文案，完成后切换为汇总', () => {
    const read = createToolCall('read_file', { path: 'README.md' })
    const bash = createToolCall('execute_command', { command: 'pnpm check' }, 'executing')
    const runningMessages = [
      createAssistantMessage('tool-step', [read, bash]),
      createToolResult(read, '已读取 README'),
    ]
    const view = renderBubble(runningMessages)

    // 执行中：header 是最新工具而非汇总
    expect(screen.getByText('pnpm check')).toBeInTheDocument()
    expect(screen.queryByText(/读取 1 次/)).not.toBeInTheDocument()

    // 工具完成 + 最终回答后：切换为汇总
    const bashCompleted: ToolCallContent = { ...bash, executeState: 'completed' }
    view.rerender(
      <MessageBubble
        messages={[
          createAssistantMessage('tool-step', [read, bashCompleted]),
          ...runningMessages.slice(1),
          createToolResult(bashCompleted, 'stdout:\nok\nexitCode=0'),
          createAssistantMessage('final', [{ type: 'text', text: '完成' }]),
        ]}
        onCopyMessage={vi.fn()}
      />,
    )

    expect(screen.getByText('读取 1 次 · 运行 1 条命令')).toBeInTheDocument()
  })

  it('末尾单工具已返回结果但当前轮仍运行时继续展示活动态', () => {
    const read = createToolCall('read_file', { path: 'README.md' })
    renderBubble([
      createAssistantMessage('tool-step', [read], 'typing'),
      createToolResult(read, '已读取 README'),
    ])

    expect(screen.getByRole('button', { name: '读取 README.md，执行中' })).toBeInTheDocument()
  })

  it('提供用途说明的命令在标题展示说明，展开体展示终端会话块', () => {
    const bash = createToolCall('execute_command', { command: 'pnpm install', description: '安装项目依赖' })
    const { container } = renderBubble([
      createAssistantMessage('tool-step', [bash]),
      createToolResult(bash, 'stdout:\nadded 10 packages\nexitCode=0'),
      createAssistantMessage('final', [{ type: 'text', text: '完成' }]),
    ])

    expect(screen.getByText('安装项目依赖')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '终端' })).toBeInTheDocument()

    fireEvent.click(screen.getByText('安装项目依赖'))

    expect(container.textContent).toContain('$ pnpm install')
    expect(container.textContent).toContain('added 10 packages')
    expect(container.textContent).not.toContain('stdout:')
  })

  it('执行失败的命令在展开体保留退出码且不露出标准错误标记行', () => {
    const bash = createToolCall('execute_command', { command: 'ls missing' })
    const { container } = renderBubble([
      createAssistantMessage('tool-step', [bash]),
      createToolResult(bash, 'stderr:\nnot found\nexitCode=1', true),
      createAssistantMessage('final', [{ type: 'text', text: '完成' }]),
    ])

    fireEvent.click(screen.getByText('ls missing'))

    expect(container.textContent).toContain('exit 1')
    expect(container.textContent).not.toContain('stderr:')
  })

  it('powerShell 命令按解释器元数据展示终端提示符', () => {
    const command = {
      ...createToolCall('execute_command', { command: 'Get-ChildItem' }),
      command: { interpreter: 'powershell7' as const },
    }
    const { container } = renderBubble([
      createAssistantMessage('tool-step', [command]),
      createToolResult(command, 'stdout:\nREADME.md\nexitCode=0'),
      createAssistantMessage('final', [{ type: 'text', text: '完成' }]),
    ])

    fireEvent.click(screen.getByText('Get-ChildItem'))

    expect(container.textContent).toContain('PS> Get-ChildItem')
    expect(screen.getByRole('img', { name: '终端' })).toBeInTheDocument()
  })

  it('编辑文件工具的标题展示增删行统计，展开后展示差异', () => {
    const edit = createToolCall('edit_file', {
      path: 'src/a.ts',
      edits: [{ oldText: 'const a = 1', newText: 'const a = 2\nconst b = 3' }],
    })
    const { container } = renderBubble([
      createAssistantMessage('tool-step', [edit]),
      createToolResult(edit, 'replacements=1'),
      createAssistantMessage('final', [{ type: 'text', text: '完成' }]),
    ])

    expect(screen.getByText('编辑 src/a.ts')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('编辑 src/a.ts'))

    expect(container.textContent).toContain('-const a = 1')
    expect(container.textContent).toContain('+const a = 2')
  })

  it('来自 MCP 的工具在标题展示短名，并将服务名作为次要文本', () => {
    const mcp = createToolCall('github___create_issue', { title: 'x' })
    renderBubble([
      createAssistantMessage('tool-step', [mcp]),
      createToolResult(mcp, 'created'),
      createAssistantMessage('final', [{ type: 'text', text: '完成' }]),
    ])

    expect(screen.getByText('create_issue')).toBeInTheDocument()
    expect(screen.getByText('github')).toBeInTheDocument()
  })

  it('短名与 bash 碰撞的 MCP 工具展开后仍展示原始结果', () => {
    const mcp = createToolCall('remote___bash', { command: '不应作为原生命令' })
    const { container } = renderBubble([
      createAssistantMessage('tool-step', [mcp]),
      createToolResult(mcp, 'stdout:\n远端工具原始结果\nexitCode=0'),
      createAssistantMessage('final', [{ type: 'text', text: '完成' }]),
    ])

    fireEvent.click(screen.getByText('bash'))

    expect(container.textContent).toContain('stdout:')
    expect(container.textContent).not.toContain('$ 不应作为原生命令')
  })

  it('思考过程流式输出期间展示思考中，完成后展示思考完成', () => {
    const view = renderBubble([
      createAssistantMessage('thinking', [], 'typing', '正在分析上下文'),
    ])
    expect(screen.getByText('思考中')).toBeInTheDocument()

    view.rerender(
      <MessageBubble
        messages={[createAssistantMessage('thinking', [{ type: 'text', text: '结论' }], 'success', '正在分析上下文')]}
        onCopyMessage={vi.fn()}
      />,
    )
    expect(screen.getByText('思考完成')).toBeInTheDocument()
  })

  it('追加指令作为流内卡片直接展示', () => {
    const read = createToolCall('read_file', { path: 'a.ts' })
    renderBubble([
      createAssistantMessage('tool-step', [read]),
      createToolResult(read, 'a'),
      createSteering('顺便把测试也改了'),
      createAssistantMessage('final', [{ type: 'text', text: '已更新' }]),
    ])

    expect(screen.getByText('追加指令')).toBeInTheDocument()
    expect(screen.getByText('顺便把测试也改了')).toBeInTheDocument()
    expect(screen.getByText('已更新')).toBeInTheDocument()
  })

  it('仅有错误内容时展示失败 Alert，不出现执行过程面板', () => {
    renderBubble([
      createAssistantMessage('failed-answer', [
        { type: 'error', error: '模型请求失败' },
      ], 'error'),
    ])

    expect(screen.queryByText(/执行过程/)).not.toBeInTheDocument()
    expect(screen.getByText('请求失败')).toBeInTheDocument()
    expect(screen.getByText('模型请求失败')).toBeInTheDocument()
  })

  it('错误块在前后正文之间原位展示失败提示', () => {
    const { container } = renderBubble([
      createAssistantMessage('failed-answer', [
        { type: 'text', text: '已完成部分回答' },
        { type: 'error', error: '模型请求失败' },
        { type: 'text', text: '错误后的补充说明' },
      ], 'error'),
    ])

    expect(screen.getByText('已完成部分回答')).toBeInTheDocument()
    expect(screen.getByText('请求失败')).toBeInTheDocument()
    expect(screen.getByText('模型请求失败')).toBeInTheDocument()
    expect(container.textContent?.indexOf('模型请求失败')).toBeLessThan(
      container.textContent?.indexOf('错误后的补充说明') ?? -1,
    )
    expect((container.textContent || '').match(/模型请求失败/g)).toHaveLength(1)
  })

  it('任务取消且无正文时展示中文取消提示', () => {
    renderBubble([createAssistantMessage('cancelled', [], 'cancel')])

    expect(screen.getByText('任务已取消')).toBeInTheDocument()
  })

  it('上下文压缩进行中时展示加载状态', () => {
    const { container } = renderBubble([
      {
        id: 'compact-event',
        convId: 'conv-1',
        role: 'event',
        status: 'loading',
        content: [{ type: 'text', text: '正在压缩上下文...' }],
        eventType: 'compaction',
        createdAt: 1,
      },
    ])

    expect(screen.getByText('正在压缩上下文')).toBeInTheDocument()
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('增量消息更新气泡尾部后仍按本轮首条助手消息计时', () => {
    vi.useFakeTimers()
    vi.setSystemTime(11_000)

    const first = createAssistantMessage('tool-call', [
      createToolCall('execute_command', { command: 'pnpm check' }, 'executing'),
    ])
    first.createdAt = 1_000
    const second = createAssistantMessage('answer-1', [{ type: 'text', text: '处理中' }], 'typing')
    second.createdAt = 9_000

    const view = renderBubble([first, second])
    expect(screen.getByText((_, element) => element?.textContent === '耗时10.0s')).toBeInTheDocument()

    const third = createAssistantMessage('answer-2', [{ type: 'text', text: '继续处理' }], 'typing')
    third.createdAt = 10_500
    view.rerender(<MessageBubble messages={[first, second, third]} onCopyMessage={vi.fn()} />)

    expect(screen.getByText((_, element) => element?.textContent === '耗时10.0s')).toBeInTheDocument()
    vi.useRealTimers()
  })
})
