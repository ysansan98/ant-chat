import type { IAIProvider, ModelsDevModel, ProviderAuthStatus, ProviderCapabilities, ProviderConfigModelSchema, ProviderConfigSchema, ProviderFormat, ProviderIntegrationId, ProviderUsageStatus } from '@ant-chat/shared'

/** 媒体生成种类；Integration 按能力分类声明，实例自知种类。 */
export type MediaKind = 'image' | 'video'

/**
 * 媒体生成请求。
 *
 * 不带 `kind` 字段：generator 由 `Partial<Record<MediaKind, MediaGeneratorFactory>>`
 * 按能力分类创建，请求再带 `kind` 存在不一致风险（`kind: 'image'` 打到 video generator）。
 */
export interface MediaGenerationRequest {
  model: string
  prompt: string
  /**
   * 目标尺寸（像素）。通用接口用数字对，厂商格式（如 ModelScope 的 '1024x1024'）
   * 由 Integration 内部转换——接第二家厂商时尺寸表达分歧不再侵入调用方。
   */
  width?: number
  height?: number
  negativePrompt?: string
  steps?: number
  guidance?: number
  seed?: number
  /** 产物落地目录（绝对路径），由调用方显式传入（CLI `--output`），后端必填校验、无默认。 */
  outputDir: string
  /** 总超时（ms）；未传时不主动超时，依赖 AbortSignal 取消（调用方决定超时）。 */
  timeoutMs?: number
  signal?: AbortSignal
}

export interface MediaGenerationResult {
  providerId: string
  modelId: string
  /** 已下载到本地的产物。 */
  files: Array<{ path: string, mediaType: string, bytes: number }>
  taskId?: string
  elapsedMs: number
}

/**
 * 单一 provider 的媒体生成器。
 *
 * 异步协议（submit + poll）封在 Integration 内部，对上层是带 `AbortSignal`
 * 的 Promise——上层不需要知道 ModelScope 是异步的、OpenAI 是同步的。
 */
export interface MediaGenerator {
  generate: (request: MediaGenerationRequest) => Promise<MediaGenerationResult>
}

export type MediaGeneratorFactory = (provider: ProviderConfigSchema) => MediaGenerator

export interface ProviderModelDefinition {
  id: string
  name: string
  maxOutputTokens?: number
  contextLength?: number
  temperature?: number
  capabilities?: ProviderConfigModelSchema['capabilities']
  cost?: ProviderConfigModelSchema['cost']
}

export interface ProviderModelSource {
  listModels: (provider: ProviderConfigSchema) => Promise<ProviderModelDefinition[]>
}

export interface ProviderAuthAdapter {
  startLogin: (provider: ProviderConfigSchema, redirectUri: string) => { authorizationUrl: string }
  handleCallback: (params: URLSearchParams) => Promise<boolean>
  importLocalAuth?: (provider: ProviderConfigSchema) => Promise<ProviderAuthStatus>
  getStatus: (provider: ProviderConfigSchema) => Promise<ProviderAuthStatus>
  logout: (provider: ProviderConfigSchema) => Promise<void>
  dispose?: () => void
}

export interface PreparedCredentialRevocation {
  commit: () => Promise<void>
  rollback: () => Promise<void>
}

export interface ProviderIntegration {
  descriptor: {
    label: string
    defaultApiMode: ProviderFormat
    fixedApiMode?: ProviderFormat
  }
  capabilities: ProviderCapabilities
  modelSource: ProviderModelSource
  /** 校验合并后的完整 Provider 配置；厂商 endpoint/wire invariant 由 Integration 拥有。 */
  validateConfig: (provider: ProviderConfigSchema) => void
  /** 先快照再撤销；settings 提交失败时由 Integration 恢复自己的凭据和内存状态。 */
  prepareRevoke: (provider: ProviderConfigSchema) => Promise<PreparedCredentialRevocation>
  auth?: ProviderAuthAdapter
  createAIProvider?: (provider: ProviderConfigSchema) => Promise<IAIProvider>
  /** 生成类能力通道；未实现的能力不声明，调用方 fail closed。 */
  mediaGeneration?: Partial<Record<MediaKind, MediaGeneratorFactory>>
  getUsage?: (provider: ProviderConfigSchema) => Promise<ProviderUsageStatus>
  /** 卸载单个 Provider 的内存状态（会话/coordinator），不删除持久化凭据。 */
  discard?: (providerId: string) => void
  /** 卸载整个 Integration：失效所有在途写回并释放内存状态。 */
  dispose?: () => void
}

export function createModelsDevModelSource(
  listModels: (providerId: string) => Promise<ModelsDevModel[]>,
): ProviderModelSource {
  return {
    async listModels(provider) {
      return (await listModels(provider.id)).map(toModelsDevModelDefinition)
    },
  }
}

export function createDefaultProviderIntegration(
  modelSource: ProviderModelSource,
  credentialStore: {
    getProviderApiKey: (providerId: string) => Promise<string | null>
    saveProviderApiKey: (input: { providerId: string, apiKey: string }) => Promise<unknown>
    deleteProviderApiKey: (providerId: string) => Promise<void>
  },
): ProviderIntegration {
  return {
    descriptor: { label: 'API Key', defaultApiMode: 'openai' },
    capabilities: {
      authentication: 'api-key',
      modelSource: 'models-dev',
      localAuthImport: false,
      usage: 'none',
      endpoint: 'custom',
    },
    modelSource,
    validateConfig(provider) {
      if (provider.integrationId !== 'api-key') {
        throw new Error(`API Key Integration 不接受 ${provider.integrationId} 配置。`)
      }
    },
    async prepareRevoke(provider) {
      const previous = await credentialStore.getProviderApiKey(provider.id)
      return {
        commit: () => credentialStore.deleteProviderApiKey(provider.id),
        rollback: async () => {
          if (previous === null) {
            await credentialStore.deleteProviderApiKey(provider.id)
          }
          else {
            await credentialStore.saveProviderApiKey({ providerId: provider.id, apiKey: previous })
          }
        },
      }
    },
  }
}

function toModelsDevModelDefinition(model: ModelsDevModel): ProviderModelDefinition {
  // modalities 为可选字段：无数据时不写（undefined = 未声明），
  // 避免空数组被语义化为"确认不支持任何输入"（与 Codex 路径的 length 保护一致）。
  const inputModalities = model.modalities?.input?.length
    ? model.modalities.input as NonNullable<ProviderConfigModelSchema['capabilities']>['inputModalities']
    : undefined
  const outputModalities = model.modalities?.output?.length
    ? model.modalities.output as NonNullable<ProviderConfigModelSchema['capabilities']>['outputModalities']
    : undefined
  return {
    id: model.model,
    name: model.name,
    contextLength: model.contextLength,
    maxOutputTokens: model.maxOutputTokens,
    capabilities: {
      functionCall: model.toolCall ?? false,
      reasoning: model.reasoning ?? false,
      reasoningLevels: model.reasoningLevels,
      supportsTemperature: model.supportsTemperature ?? false,
      structuredOutput: model.structuredOutput ?? false,
      ...(inputModalities ? { inputModalities } : {}),
      ...(outputModalities ? { outputModalities } : {}),
    },
    cost: model.cost,
  }
}

/** 厂商 Integration 注册表；key 是 Integration 标识，注册发生在 composition root。 */
export type ProviderIntegrationRegistry = ReadonlyMap<ProviderIntegrationId, ProviderIntegration>
