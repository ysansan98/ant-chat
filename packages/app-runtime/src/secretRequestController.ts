import type { IAgentEventEmitter, SecretRef, SecretRequestController, SecretStore } from '@ant-chat/shared'
import { randomUUID } from 'node:crypto'

const SECRET_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

export class RuntimeSecretRequestController implements SecretRequestController {
  private readonly pending = new Map<string, {
    runId: string
    label: string
    resolve: (ref: SecretRef) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  constructor(
    private readonly secretStore: SecretStore,
    private readonly eventEmitter: Pick<IAgentEventEmitter, 'emitSecretRequested'>,
  ) {}

  async requestSecret(input: {
    runId: string
    conversationId: string
    label: string
    reason?: string
  }): Promise<SecretRef> {
    const requestId = randomUUID()
    return await new Promise<SecretRef>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('敏感信息请求超时'))
      }, SECRET_REQUEST_TIMEOUT_MS)

      this.pending.set(requestId, {
        runId: input.runId,
        label: input.label,
        resolve,
        reject,
        timer,
      })

      void this.eventEmitter.emitSecretRequested?.({
        requestId,
        runId: input.runId,
        conversationId: input.conversationId,
        label: input.label,
        reason: input.reason,
        createdAt: Date.now(),
      })
    })
  }

  resolveSecretRequest(input: { requestId: string, value: string }): void {
    const pending = this.requirePending(input.requestId)
    void this.secretStore.createTurnSecret({
      runId: pending.runId,
      label: pending.label,
      value: input.value,
    }).then(pending.resolve, pending.reject)
    this.deletePending(input.requestId)
  }

  rejectSecretRequest(input: { requestId: string, reason?: string }): void {
    const pending = this.requirePending(input.requestId)
    pending.reject(new Error(input.reason || '用户拒绝提供敏感信息'))
    this.deletePending(input.requestId)
  }

  private requirePending(requestId: string) {
    const pending = this.pending.get(requestId)
    if (!pending) {
      throw new Error(`未找到敏感信息请求：${requestId}`)
    }
    return pending
  }

  private deletePending(requestId: string): void {
    const pending = this.pending.get(requestId)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
  }
}
