import type { IAgentEventEmitter, SecretRequestController, SecretRequestField, SecretRequestInput, SecretRequestResult, SecretStore } from '@ant-chat/shared'
import { randomUUID } from 'node:crypto'

const SECRET_REQUEST_TIMEOUT_MS = 5 * 60 * 1000

export class RuntimeSecretRequestController implements SecretRequestController {
  private readonly pending = new Map<string, {
    runId: string
    fields: SecretRequestField[]
    resolve: (result: SecretRequestResult) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
    signal?: AbortSignal
    onAbort: () => void
  }>()

  constructor(
    private readonly secretStore: SecretStore,
    private readonly eventEmitter: Pick<IAgentEventEmitter, 'emitSecretRequested'>,
  ) {}

  async requestSecret(input: SecretRequestInput): Promise<SecretRequestResult> {
    const requestId = randomUUID()
    const fields = normalizeFields(input)
    if (input.signal?.aborted)
      throw new Error('任务已取消')

    return await new Promise<SecretRequestResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.deletePending(requestId)
        reject(new Error('敏感信息请求超时'))
      }, SECRET_REQUEST_TIMEOUT_MS)
      const onAbort = () => {
        if (!this.pending.has(requestId))
          return
        this.deletePending(requestId)
        reject(new Error('任务已取消'))
      }

      this.pending.set(requestId, {
        runId: input.runId,
        fields,
        resolve,
        reject,
        timer,
        signal: input.signal,
        onAbort,
      })
      input.signal?.addEventListener('abort', onAbort, { once: true })
      if (input.signal?.aborted) {
        onAbort()
        return
      }

      void this.eventEmitter.emitSecretRequested?.({
        requestId,
        automationRunId: input.automationRunId,
        runId: input.runId,
        conversationId: input.conversationId,
        label: input.label,
        fields,
        reason: input.reason,
        createdAt: Date.now(),
      })
    })
  }

  resolveSecretRequest(input: { requestId: string, value?: string, values?: Record<string, string> }): void {
    const pending = this.requirePending(input.requestId)
    const values = normalizeValues(input, pending.fields)
    void Promise.all(
      pending.fields.map(async (field) => {
        const ref = await this.secretStore.createTurnSecret({
          runId: pending.runId,
          label: field.label,
          value: values[field.key],
        })
        return [field.key, ref] as const
      }),
    ).then((entries) => {
      const secretRefs = Object.fromEntries(entries)
      pending.resolve({
        secretRef: pending.fields.length === 1 ? secretRefs[pending.fields[0].key] : undefined,
        secretRefs,
      })
    }, pending.reject)
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
    pending.signal?.removeEventListener('abort', pending.onAbort)
    this.pending.delete(requestId)
  }
}

function normalizeFields(input: { label: string, fields?: SecretRequestField[] }): SecretRequestField[] {
  if (input.fields?.length) {
    return input.fields.map((field) => {
      const key = field.key.trim()
      const label = field.label.trim()
      if (!key || !label) {
        throw new Error('敏感信息字段必须包含 key 和 label')
      }
      return { key, label }
    })
  }
  return [{ key: 'value', label: input.label }]
}

function normalizeValues(
  input: { value?: string, values?: Record<string, string> },
  fields: SecretRequestField[],
): Record<string, string> {
  if (input.values) {
    return fields.reduce<Record<string, string>>((acc, field) => {
      const value = input.values?.[field.key]
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`缺少敏感信息字段：${field.label}`)
      }
      acc[field.key] = value
      return acc
    }, {})
  }
  if (fields.length === 1 && typeof input.value === 'string') {
    return { [fields[0].key]: input.value }
  }
  throw new Error('敏感信息请求缺少提交值')
}
