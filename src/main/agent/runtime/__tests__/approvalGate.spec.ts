import { describe, expect, it } from 'vitest'
import { ApprovalGate } from '../approvalGate'

describe('approvalGate', () => {
  it('approve 后恢复执行', async () => {
    const gate = new ApprovalGate()
    const pending = gate.wait('a1', 1000)
    gate.approve('a1')
    await expect(pending).resolves.toEqual({ approved: true })
  })

  it('reject 返回拒绝原因', async () => {
    const gate = new ApprovalGate()
    const pending = gate.wait('a2', 1000)
    gate.reject('a2', 'no')
    await expect(pending).resolves.toEqual({ approved: false, reason: 'no' })
  })

  it('超时失败', async () => {
    const gate = new ApprovalGate()
    await expect(gate.wait('a3', 1)).rejects.toThrow('AGENT_APPROVAL_TIMEOUT')
  })
})
