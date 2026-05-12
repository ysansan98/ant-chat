export interface ApprovalResolution {
  approved: boolean
  reason?: string
}

export class ApprovalGate {
  private readonly waiters = new Map<string, { resolve: (value: ApprovalResolution) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()

  wait(actionId: string, timeoutMs: number) {
    return new Promise<ApprovalResolution>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(actionId)
        reject(new Error('AGENT_APPROVAL_TIMEOUT'))
      }, timeoutMs)
      this.waiters.set(actionId, { resolve, reject, timer })
    })
  }

  approve(actionId: string) {
    const waiter = this.waiters.get(actionId)
    if (!waiter) {
      throw new Error('AGENT_TASK_NOT_APPROVABLE')
    }
    clearTimeout(waiter.timer)
    this.waiters.delete(actionId)
    waiter.resolve({ approved: true })
  }

  reject(actionId: string, reason?: string) {
    const waiter = this.waiters.get(actionId)
    if (!waiter) {
      throw new Error('AGENT_TASK_NOT_APPROVABLE')
    }
    clearTimeout(waiter.timer)
    this.waiters.delete(actionId)
    waiter.resolve({ approved: false, reason })
  }
}
