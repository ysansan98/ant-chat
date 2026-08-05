import type { AppSettingsState } from '@ant-chat/shared'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ProviderModule } from '../../../../app-runtime/modules/provider'
import { createCodexProviderIntegration } from '../../../../app-runtime/modules/provider/codexIntegration'
import { AppSettingsStore } from '../../../../data/settings/appSettingsStore'
import { DEFAULT_APP_SETTINGS } from '../../../../data/settings/defaultAppSettings'
import { ProviderSettingsRepository } from '../../../../data/settings/providerSettingsRepository'
import type { RuntimeEventBus } from '../../../../events'
import { parseCodexCredential } from '../auth'
import { KeychainSecretStore } from '../../../../secretStore'
import type { SystemLogger } from '../../../../systemLogger'

/**
 * 只读 live 测试必须显式开启，避免默认 Vitest 或 CI 访问真实 Codex API。
 * 本文件不覆盖 /responses；生成测试必须使用独立的额度开关。
 */
const liveDescribe = process.env.CODEX_LIVE_TEST === '1' ? describe : describe.skip

liveDescribe('Codex 订阅只读 live 集成', () => {
  let directory: string | undefined
  let providerModule: ProviderModule | undefined
  let credentialRead: ReturnType<typeof vi.spyOn> | undefined

  beforeAll(async () => {
    const secretStore = new KeychainSecretStore()
    const rawCredential = await secretStore.getProviderIntegrationCredential({ providerId: 'codex', integrationId: 'codex-subscription' })
    if (!rawCredential) {
      throw new Error('CODEX_LIVE_TEST=1 已开启，但 ant-chat Keychain 中不存在 Codex 凭据。')
    }
    if (!parseCodexCredential(rawCredential)) {
      throw new Error('CODEX_LIVE_TEST=1 已开启，但 ant-chat Keychain 中的 Codex 凭据格式无效。')
    }

    credentialRead = vi.spyOn(secretStore, 'getProviderIntegrationCredential')
    directory = mkdtempSync(path.join(tmpdir(), 'ant-chat-codex-live-'))
    const codexProvider = DEFAULT_APP_SETTINGS.providers.find(provider => provider.id === 'codex')!
    const settings: AppSettingsState = {
      ...DEFAULT_APP_SETTINGS,
      providers: [codexProvider],
    }
    const repository = new ProviderSettingsRepository(new AppSettingsStore({
      filePath: path.join(directory, 'settings.json'),
      initialSettings: settings,
    }))

    providerModule = new ProviderModule(
      repository,
      secretStore,
      { emit: vi.fn() } as unknown as RuntimeEventBus,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SystemLogger,
      undefined,
      [['codex-subscription', createCodexProviderIntegration(secretStore)]],
    )
  })

  afterAll(() => {
    providerModule?.dispose()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  it('通过 ProviderModule 真实读取 Codex 模型目录并保留能力结构', async () => {
    const models = await providerModule!.syncModels({ providerId: 'codex' })

    expect(credentialRead).toHaveBeenCalledWith('codex')
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      expect(model.model).toEqual(expect.any(String))
      expect(model.name).toEqual(expect.any(String))
      expect(model.capabilities).toEqual(expect.objectContaining({
        functionCall: true,
        reasoning: expect.any(Boolean),
      }))
    }

    const reasoningLevels = models.flatMap(model => model.capabilities?.reasoningLevels ?? [])
    expect(reasoningLevels).toEqual(expect.arrayContaining(['low', 'medium', 'high', 'xhigh']))
  })

  it('通过 ProviderModule 真实读取 Codex 额度并返回规范化结构', async () => {
    const usage = await providerModule!.getUsage({ providerId: 'codex' })

    expect(Object.keys(usage).length).toBeGreaterThan(0)
    if (usage.planType !== undefined) {
      expect(usage.planType).toEqual(expect.any(String))
    }
    if (usage.limitReached !== undefined) {
      expect(usage.limitReached).toEqual(expect.any(Boolean))
    }
    for (const window of [usage.primaryWindow, usage.secondaryWindow]) {
      if (window) {
        expect(window).toEqual({
          usedPercent: expect.any(Number),
          limitWindowSeconds: expect.any(Number),
          resetAfterSeconds: expect.any(Number),
          resetAt: expect.any(Number),
        })
      }
    }
    if (usage.creditsBalance !== undefined) {
      expect(usage.creditsBalance).toEqual(expect.any(String))
    }
    expect(
      usage.planType !== undefined
      || usage.limitReached !== undefined
      || usage.primaryWindow !== undefined
      || usage.secondaryWindow !== undefined
      || usage.creditsBalance !== undefined,
    ).toBe(true)
  })
})
