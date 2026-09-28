import type { ProviderConfigModelSchema, ProviderConfigSchema } from '@ant-chat/shared'
import type { GeneralSettingsRepository, ProviderSettingsRepository } from '../../../data'
import type { SystemLogger } from '../../../systemLogger'
import type { MediaGenerationResult, MediaGenerator, MediaKind } from '../provider/providerIntegration'
import path from 'node:path'

export interface GenerationModuleOptions {
  providerSettingsRepository: ProviderSettingsRepository
  settingsRepository: GeneralSettingsRepository
  /** 按 Integration 声明的能力解析媒体生成器；未声明该能力时返回 undefined（fail closed）。 */
  resolveMediaGenerator: (provider: ProviderConfigSchema, kind: MediaKind) => MediaGenerator | undefined
  logger: SystemLogger
}

export interface ImageGenerateInput {
  prompt: string
  width?: number
  height?: number
  /**
   * 产物落地目录（绝对路径）。CLI 在自己的 cwd 下解析 `--output` 后传入，
   * 后端不做相对路径解析——后端进程 cwd 与调用者不同，静默解析会落错位置。
   */
  outputDir: string
  /** 总超时（ms）：透传给 generator；未传时不主动超时，依赖 AbortSignal 取消。 */
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * 媒体生成控制面能力（当前只有图像生成，视频后续同族扩展）。
 *
 * 不复用 ImageModule（后者只管识别）：职责链为「设置页解析模型 →
 * 校验输出能力 → 取 Integration 的 generator → 阻塞生成并落盘」。
 * 产物落盘即交付终点——是否进入聊天由 agent 用 `send_attachment` 显式转发决定。
 */
export class GenerationModule {
  constructor(private readonly options: GenerationModuleOptions) {}

  async generateImage(input: ImageGenerateInput): Promise<MediaGenerationResult> {
    const { providerId, provider, model } = await this.resolveImageModel()
    const generator = this.options.resolveMediaGenerator(provider, 'image')
    if (!generator) {
      throw new Error(`服务商 ${providerId}（${provider.integrationId}）不支持图像生成，请检查设置页配置`)
    }
    if (!path.isAbsolute(input.outputDir)) {
      throw new Error(`产物目录必须是绝对路径（收到：${input.outputDir}）`)
    }
    const result = await generator.generate({
      model: model.model,
      prompt: input.prompt,
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      outputDir: input.outputDir,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    })
    this.options.logger.info(`Image generation completed: ${providerId}/${result.modelId}（${result.files.length} 个产物）`)
    return result
  }

  /**
   * 解析生图模型：只用设置页配置（CLI 不暴露模型参数，决策 7），
   * 并校验 outputModalities 含 image——与视觉模型按 inputModalities 过滤同构。
   */
  private async resolveImageModel(): Promise<{
    providerId: string
    modelId: string
    provider: NonNullable<ReturnType<ProviderSettingsRepository['getProviderById']>>
    model: ProviderConfigModelSchema
  }> {
    const settings = await this.options.settingsRepository.getGeneralSettings()
    const providerId = settings.imageGenProviderId
    const modelId = settings.imageGenModelId
    if (!providerId || !modelId) {
      throw new Error('未配置图像生成模型；请先在设置页配置图像生成模型')
    }
    const provider = this.options.providerSettingsRepository.getProviderById(providerId)
    if (!provider) {
      throw new Error(`Provider 不存在：${providerId}`)
    }
    const model = this.options.providerSettingsRepository.listProviderModels(providerId)
      .find(item => item.model === modelId)
    if (!model) {
      throw new Error(`模型不存在：${providerId}/${modelId}`)
    }
    if (!supportsImageOutput(model)) {
      throw new Error(`模型 ${providerId}/${modelId} 不支持图像生成，请在设置页选择支持图像输出的模型`)
    }
    return { providerId, modelId, provider, model }
  }
}

function supportsImageOutput(model: ProviderConfigModelSchema): boolean {
  return model.capabilities?.outputModalities?.includes('image') === true
}
