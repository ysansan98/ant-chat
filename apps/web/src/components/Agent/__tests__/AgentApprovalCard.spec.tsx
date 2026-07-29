import type { AgentPendingAction } from '@ant-chat/shared'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AgentApprovalCard from '../AgentApprovalCard'

function createPending(overrides: Partial<AgentPendingAction> = {}): AgentPendingAction {
  return {
    actionId: 'action-1',
    toolName: 'write_file',
    operationType: 'write',
    scope: 'workspace',
    inputPreview: '{"path":"TODO.md"}',
    createdAt: 1,
    ...overrides,
  }
}

function createDeferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('审批卡片', () => {
  it('清楚标识 MCP 工具的审批类型和外部资源域', () => {
    render(
      <AgentApprovalCard
        pending={createPending({
          toolName: 'github__list_issues',
          operationType: 'mcp',
          scope: 'external',
          inputPreview: '{}',
        })}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    )

    expect(screen.getByText('MCP 工具')).toBeInTheDocument()
    expect(screen.getByText('外部服务')).toBeInTheDocument()
  })

  it('提交期间禁用操作并阻止重复批准', async () => {
    const deferred = createDeferred()
    const onApprove = vi.fn(() => deferred.promise)
    render(
      <AgentApprovalCard
        pending={createPending()}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    )

    const approveButton = screen.getByRole('button', { name: '仅本次批准' })
    fireEvent.click(approveButton)
    fireEvent.click(approveButton)

    expect(onApprove).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '拒绝' })).toBeDisabled()

    deferred.resolve()
    await waitFor(() => expect(onApprove).toHaveBeenCalledOnce())
  })

  it('提交失败后显示错误并允许重试', async () => {
    const onApprove = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('权限文件写入失败'))
      .mockResolvedValueOnce()
    render(
      <AgentApprovalCard
        pending={createPending()}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '仅本次批准' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('权限文件写入失败')
    expect(screen.getByRole('button', { name: '重试批准' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '重试批准' }))
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(2))
  })

  it('命令任意参数授权必须在独立对话框中再次确认', async () => {
    const onApprove = vi.fn(async () => {})
    render(
      <AgentApprovalCard
        pending={createPending({
          toolName: 'execute_command',
          operationType: 'command',
          approvalCandidates: {
            candidates: [{
              type: 'command-segment',
              interpreter: 'bash',
              segmentIndex: 0,
              executable: 'git',
              displayCommand: 'git status --short',
              argvPrefix: ['status', '--short'],
              canWholeExecutable: true,
              resourceScope: 'workspace',
            }],
            context: {},
          },
        })}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '记住命令 git status --short · Bash' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '允许该命令使用任意参数（范围较大）' }))
    fireEvent.click(screen.getByRole('button', { name: '批准并记住' }))

    expect(onApprove).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '确认允许命令使用任意参数' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认授权' }))
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith({
      selections: [{
        candidateIndex: 0,
        adjustedArgvPrefix: [],
        allowRemainingArgs: true,
        wholeExecutable: true,
      }],
      scope: 'workspace',
    }))
  })

  it('命令规则只能从实际参数中选择固定前缀', async () => {
    const onApprove = vi.fn(async () => {})
    render(
      <AgentApprovalCard
        pending={createPending({
          toolName: 'execute_command',
          operationType: 'command',
          approvalCandidates: {
            candidates: [{
              type: 'command-segment',
              interpreter: 'bash',
              segmentIndex: 0,
              executable: 'git',
              displayCommand: 'git show HEAD --stat',
              argvPrefix: ['show', 'HEAD', '--stat'],
              canWholeExecutable: true,
              resourceScope: 'workspace',
            }],
            context: {},
          },
        })}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '记住命令 git show HEAD --stat · Bash' }))
    fireEvent.change(screen.getByRole('combobox', { name: '固定参数边界' }), { target: { value: '1' } })

    expect(screen.getByRole('checkbox', { name: '允许在固定参数后追加任意数量参数' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '允许在固定参数后追加任意数量参数' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('以上固定参数必须完全一致；其后参数可以没有，也可以追加任意多个。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '批准并记住' }))

    await waitFor(() => expect(onApprove).toHaveBeenCalledWith({
      selections: [{
        candidateIndex: 0,
        adjustedArgvPrefix: ['show'],
        allowRemainingArgs: true,
      }],
      scope: 'workspace',
    }))
    expect(screen.queryByText(/glob/i)).not.toBeInTheDocument()
  })

  it('命令记忆默认精确匹配并展示最终授权范围', async () => {
    const onApprove = vi.fn(async () => {})
    render(
      <AgentApprovalCard
        pending={createPending({
          toolName: 'execute_command',
          operationType: 'command',
          approvalCandidates: {
            candidates: [{
              type: 'command-segment',
              interpreter: 'bash',
              segmentIndex: 0,
              executable: 'node',
              displayCommand: 'node run.js issue',
              argvPrefix: ['run.js', 'issue'],
              canWholeExecutable: true,
              resourceScope: 'outside',
            }],
            context: {},
          },
        })}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '记住命令 node run.js issue · Bash' }))

    expect(screen.getByRole('checkbox', { name: '允许在固定参数后追加任意数量参数' })).not.toBeChecked()
    expect(screen.getByText('仅允许参数与当前命令完全一致')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '批准并记住' }))
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith({
      selections: [{
        candidateIndex: 0,
        adjustedArgvPrefix: ['run.js', 'issue'],
        allowRemainingArgs: false,
      }],
      scope: 'workspace',
    }))
  })

  it('记住 browser_navigate 时提交域名限制', async () => {
    const onApprove = vi.fn(async () => {})
    render(
      <AgentApprovalCard
        pending={createPending({
          toolName: 'browser_navigate',
          operationType: 'browser',
          scope: 'external',
          approvalCandidates: {
            candidates: [{
              type: 'browser',
              toolName: 'browser_navigate',
              urlPattern: 'github.com',
              riskWarning: '测试',
            }],
            context: {},
          },
        })}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '记住此浏览器工具（browser_navigate · github.com）' }))
    fireEvent.change(screen.getByRole('textbox', { name: '限制域名' }), { target: { value: '*.github.com' } })
    fireEvent.click(screen.getByRole('button', { name: '批准并记住' }))

    await waitFor(() => expect(onApprove).toHaveBeenCalledWith({
      selections: [{ candidateIndex: 0, adjustedUrlPattern: '*.github.com' }],
      scope: 'workspace',
    }))
  })

  it('拒绝按钮把决定交还审批事务 owner', () => {
    const onReject = vi.fn()
    render(
      <AgentApprovalCard
        pending={createPending()}
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(onReject).toHaveBeenCalledOnce()
  })

  it('命令任意参数授权提交失败时在确认对话框内允许重试', async () => {
    const onApprove = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('权限写入失败'))
      .mockResolvedValueOnce()
    render(
      <AgentApprovalCard
        pending={createPending({
          toolName: 'execute_command',
          operationType: 'command',
          approvalCandidates: {
            candidates: [{
              type: 'command-segment',
              interpreter: 'bash',
              segmentIndex: 0,
              executable: 'git',
              displayCommand: 'git status',
              argvPrefix: ['status'],
              canWholeExecutable: true,
              resourceScope: 'workspace',
            }],
            context: {},
          },
        })}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: '记住命令 git status · Bash' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '允许该命令使用任意参数（范围较大）' }))
    fireEvent.click(screen.getByRole('button', { name: '批准并记住' }))
    fireEvent.click(screen.getByRole('button', { name: '确认授权' }))

    const dialog = screen.getByRole('dialog', { name: '确认允许命令使用任意参数' })
    expect(await screen.findByText('权限写入失败')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('权限写入失败')
    fireEvent.click(screen.getByRole('button', { name: '重试确认授权' }))

    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(2))
  })
})
