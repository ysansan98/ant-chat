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
    expect(onApprove).toHaveBeenCalledWith(false, undefined)
    expect(onReject).toHaveBeenCalledTimes(1)
  })

  it('打开开关后展示 pattern 并批准', () => {
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
          whitelistPattern: 'git **',
          createdAt: Date.now(),
        }}
        onApprove={onApprove}
        onReject={onReject}
      />,
    )

    const toggle = screen.getByTestId('agent-whitelist-toggle')
    fireEvent.click(toggle)
    expect(screen.getByText('bash(git **)')).toBeTruthy()
    fireEvent.click(screen.getByText('批准'))
    expect(onApprove).toHaveBeenCalledWith(true, undefined)
  })

  it('可切换作用域为工作区', () => {
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
          whitelistPattern: './src/**',
          createdAt: Date.now(),
        }}
        workspacePath="/Users/me/project"
        onApprove={onApprove}
        onReject={onReject}
      />,
    )

    fireEvent.click(screen.getByTestId('agent-whitelist-toggle'))
    expect(screen.getByText('write_file(./src/**)')).toBeTruthy()
    fireEvent.click(screen.getByTestId('agent-whitelist-scope-workspace'))
    fireEvent.click(screen.getByText('批准'))
    expect(onApprove).toHaveBeenCalledWith(true, '/Users/me/project')
  })
})
