import type { SecretRef, SecretRequest, SecretStore } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeSecretRequestController } from '../secretRequestController'

describe('runtimeSecretRequestController', () => {
  it('一次敏感信息请求支持多个字段并返回 secretRefs 映射', async () => {
    const requests: SecretRequest[] = []
    const secretStore: SecretStore = {
      saveProviderApiKey: vi.fn(),
      getProviderApiKey: vi.fn(),
      deleteProviderApiKey: vi.fn(),
      createTurnSecret: vi.fn(async ({ runId, label }) => ({
        kind: 'secret_ref',
        id: `turn:${runId}:${label}`,
        scope: 'turn',
      }) satisfies SecretRef),
      resolve: vi.fn(),
      clearTurnSecrets: vi.fn(),
    }
    const controller = new RuntimeSecretRequestController(secretStore, {
      emitSecretRequested: (request) => {
        requests.push(request)
      },
    })

    const pending = controller.requestSecret({
      runId: 'run-1',
      conversationId: 'conv-1',
      label: '登录凭据',
      fields: [
        { key: 'username', label: '账号' },
        { key: 'password', label: '密码' },
      ],
    })

    controller.resolveSecretRequest({
      requestId: requests[0].requestId,
      values: {
        username: 'alice',
        password: 'secret',
      },
    })

    await expect(pending).resolves.toEqual({
      secretRef: undefined,
      secretRefs: {
        username: { kind: 'secret_ref', id: 'turn:run-1:账号', scope: 'turn' },
        password: { kind: 'secret_ref', id: 'turn:run-1:密码', scope: 'turn' },
      },
    })
    expect(requests[0].fields).toEqual([
      { key: 'username', label: '账号' },
      { key: 'password', label: '密码' },
    ])
  })
})
