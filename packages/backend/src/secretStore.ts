import type { SecretRef, SecretStore } from '@ant-chat/shared'
import { randomUUID } from 'node:crypto'
import keytar from 'keytar'

const SERVICE_NAME = 'ant-chat'

export class KeychainSecretStore implements SecretStore {
  private readonly turnSecrets = new Map<string, string>()

  async saveProviderApiKey(input: { providerId: string, apiKey: string }): Promise<SecretRef> {
    const id = getProviderApiKeyId(input.providerId)
    await keytar.setPassword(SERVICE_NAME, id, input.apiKey)
    return { kind: 'secret_ref', id, scope: 'persistent' }
  }

  async getProviderApiKey(providerId: string): Promise<string | null> {
    return await keytar.getPassword(SERVICE_NAME, getProviderApiKeyId(providerId))
  }

  async deleteProviderApiKey(providerId: string): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, getProviderApiKeyId(providerId))
  }

  async saveChannelCredential(input: { channelAccountId: string, value: string }): Promise<{ kind: 'secret_ref', id: string, scope: 'persistent' }> {
    const id = `channel:${input.channelAccountId}:credential`
    await keytar.setPassword(SERVICE_NAME, id, input.value)
    return { kind: 'secret_ref', id, scope: 'persistent' }
  }

  async deleteChannelCredential(channelAccountId: string): Promise<void> {
    await keytar.deletePassword(SERVICE_NAME, `channel:${channelAccountId}:credential`)
  }

  async createTurnSecret(input: { runId: string, label: string, value: string }): Promise<SecretRef> {
    const id = `turn:${input.runId}:${randomUUID()}`
    this.turnSecrets.set(id, input.value)
    return { kind: 'secret_ref', id, scope: 'turn' }
  }

  async resolve(ref: SecretRef): Promise<string | null> {
    if (ref.scope === 'persistent') {
      return await keytar.getPassword(SERVICE_NAME, ref.id)
    }
    return this.turnSecrets.get(ref.id) ?? null
  }

  async resolveTurnSecret(ref: SecretRef, runId: string): Promise<string | null> {
    if (ref.scope !== 'turn' || !ref.id.startsWith(`turn:${runId}:`))
      return null
    return this.turnSecrets.get(ref.id) ?? null
  }

  async clearTurnSecrets(runId: string): Promise<void> {
    for (const id of this.turnSecrets.keys()) {
      if (id.startsWith(`turn:${runId}:`)) {
        this.turnSecrets.delete(id)
      }
    }
  }
}

export function getProviderApiKeyId(providerId: string): string {
  return `provider:${providerId}:api_key`
}
