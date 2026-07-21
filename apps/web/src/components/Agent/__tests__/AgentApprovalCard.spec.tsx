import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AgentApprovalCard from '../AgentApprovalCard'

describe('agentApprovalCard', () => {
  it('展示审批信息并触发按钮事件', () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    render(
      <AgentApprovalCard
        pending={{
          actionId: 'a1',
          toolName: 'write_file',
          operationType: 'write',
          scope: 'workspace',
          inputPreview: '{"path":"TODO.md"}',
          createdAt: Date.now(),
        }}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )

    expect(screen.getByText(/write_file/)).toBeTruthy()
    fireEvent.click(screen.getByText('批准'))
    fireEvent.click(screen.getByText('拒绝'))
    expect(onApprove).toHaveBeenCalledWith(undefined)
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('打开记忆授权后默认只对当前工作区生效', () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    render(
      <AgentApprovalCard
        pending={{
          actionId: 'a1',
          toolName: 'bash',
          operationType: 'bash',
          scope: 'workspace',
          inputPreview: '{"command":"git status"}',
          approvalGrant: {
            toolName: 'bash',
            operationType: 'bash',
            toolScope: 'workspace',
            pattern: 'command:git-status',
            description: '允许执行命令 git status',
          },
          createdAt: Date.now(),
        }}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )

    const toggle = screen.getByTestId('agent-whitelist-toggle')
    fireEvent.click(toggle)
    expect(screen.getByText('允许执行命令 git status')).toBeTruthy()
    fireEvent.click(screen.getByText('批准'))
    expect(onApprove).toHaveBeenCalledWith('workspace')
  })

  it('用户可显式把记忆授权切换为全局', () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    render(
      <AgentApprovalCard
        pending={{
          actionId: 'a1',
          toolName: 'write_file',
          operationType: 'write',
          scope: 'workspace',
          inputPreview: '{"path":"TODO.md"}',
          approvalGrant: {
            toolName: 'write_file',
            operationType: 'write',
            toolScope: 'workspace',
            pattern: './src/index.ts',
            description: '允许 write_file 访问 ./src/index.ts',
          },
          createdAt: Date.now(),
        }}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )

    fireEvent.click(screen.getByTestId('agent-whitelist-toggle'))
    expect(screen.getByText('允许 write_file 访问 ./src/index.ts')).toBeTruthy()
    fireEvent.click(screen.getByTestId('agent-whitelist-scope-global'))
    fireEvent.click(screen.getByText('批准'))
    expect(onApprove).toHaveBeenCalledWith('global')
  })
})
