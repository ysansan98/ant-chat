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
          riskLevel: 'L1',
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
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledTimes(1)
  })
})
