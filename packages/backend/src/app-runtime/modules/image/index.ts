import type { AgentModel, AIProviderFactory, IAIStreamChunk, ProviderConfigModelSchema } from '@ant-chat/shared'
import type { GeneralSettingsRepository, ProviderSettingsRepository } from '../../../data'
import type { SystemLogger } from '../../../systemLogger'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'

/** 识别模型支持接收的图片类型（按扩展名判定）。 */
const IMAGE_MEDIA_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])

/** 与 send_attachment 对齐的图片体积上限。 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const DEFAULT_RECOGNIZE_PROMPT = '请识别这张图片并描述它的内容。'

export interface ImageModuleOptions {
  providerSettingsRepository: ProviderSettingsRepository
  settingsRepository: GeneralSettingsRepository
  /** 复用 ProviderModule 的工厂，统一走 API Key / 订阅 Integration 的凭据解析。 */
  aiProviderFactory: AIProviderFactory
  /** 按附件 file_id 读取 base64 数据（聊天附件场景，绕开文件系统路径与权限）。 */
  loadAttachmentData?: (fileId: string) => Promise<string | null>
  logger: SystemLogger
}

export interface ImageRecognizeInput {
  /** 待识别图片的绝对路径（工作区图片）；与 fileId 二选一。 */
  path?: string
  /** 聊天附件 file_id；与 path 二选一。 */
  fileId?: string
  /** 识别指令；缺省时按通用描述。 */
  prompt?: string
  providerId?: string
  modelId?: string
}

export interface ImageRecognizeResult {
  providerId: string
  modelId: string
  text: string
  usage?: IAIStreamChunk['usage']
}

/**
 * 图像识别控制面能力。
 *
 * 只做「用支持视觉输入的模型识别单张图片并返回文本」，不提供自动兜底：
 * 是否调用由 agent 按 SKILL 指示主动触发，避免消息级隐式换模型的花费与
 * 不可见失败。
 */
export class ImageModule {
  constructor(private readonly options: ImageModuleOptions) {}

  async recognize(input: ImageRecognizeInput): Promise<ImageRecognizeResult> {
    const { providerId, modelId, provider, model } = await this.resolveModel(input)
    const { data, mediaType } = input.fileId
      ? await this.readAttachment(input.fileId)
      : await this.readImage(input.path!)
    const prompt = input.prompt?.trim() || DEFAULT_RECOGNIZE_PROMPT

    const aiProvider = await this.options.aiProviderFactory({ model: toAgentModel(model), provider })
    const { text, usage } = await collectModelText(aiProvider.streamModel({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image', mimeType: mediaType, data },
        ],
      }],
      modelSettings: {
        model: model.model,
        systemPrompt: '',
      },
    }))

    const trimmed = text.trim()
    if (!trimmed) {
      throw new Error(`识别模型 ${providerId}/${modelId} 没有返回任何文本`)
    }
    this.options.logger.info(`Image recognition completed: ${providerId}/${modelId}`)
    return { providerId, modelId, text: trimmed, usage }
  }

  /** 按附件 file_id 读取图片（应用内附件存储，不经过文件系统路径）。 */
  private async readAttachment(fileId: string): Promise<{ data: string, mediaType: string }> {
    if (!this.options.loadAttachmentData) {
      throw new Error('附件读取能力未启用：请检查运行环境')
    }
    const data = await this.options.loadAttachmentData(fileId)
    if (!data) {
      throw new Error(`附件不存在或无法读取：${fileId}`)
    }
    const buffer = Buffer.from(data, 'base64')
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`图片超过 10MB 限制：${fileId}（${buffer.byteLength} bytes）`)
    }
    const mediaType = sniffImageMediaType(buffer) ?? 'image/jpeg'
    return { data, mediaType }
  }

  /**
   * 解析识别模型：显式传入优先，其次使用用户配置的视觉模型，
   * 最后回退到默认模型（仅当支持图片输入时可用）。未配置任何可用
   * 模型时给出可读错误，提示先到设置页配置视觉模型。
   */
  private async resolveModel(input: ImageRecognizeInput): Promise<{
    providerId: string
    modelId: string
    provider: NonNullable<ReturnType<ProviderSettingsRepository['getProviderById']>>
    model: ProviderConfigModelSchema
  }> {
    const settings = await this.options.settingsRepository.getGeneralSettings()
    const providerId = input.providerId ?? settings.visionProviderId ?? settings.assistantProviderId
    const modelId = input.modelId ?? settings.visionModelId ?? settings.assistantModelId
    if (!providerId || !modelId) {
      throw new Error('未配置模型；请先在设置页配置视觉模型，或用 `--provider-id/--model-id` 指定识别模型')
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
    if (!supportsImageInput(model)) {
      throw new Error(`模型 ${providerId}/${modelId} 不支持图片输入，请用 --provider-id/--model-id 指定支持视觉的模型`)
    }
    return { providerId, modelId, provider, model }
  }

  /** 读取并校验图片文件（存在性、类型、体积），返回 base64 载荷。 */
  private async readImage(rawPath: string): Promise<{ data: string, mediaType: string }> {
    const resolved = path.resolve(rawPath)
    let stats
    try {
      stats = await fs.stat(resolved)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`图片文件不存在：${rawPath}`)
      }
      throw error
    }
    if (!stats.isFile()) {
      throw new Error(`图片路径不是文件：${rawPath}`)
    }
    if (stats.size > MAX_IMAGE_BYTES) {
      throw new Error(`图片超过 10MB 限制：${rawPath}（${stats.size} bytes）`)
    }
    const buffer = await fs.readFile(resolved)
    // 优先按扩展名判定；无扩展名（如附件落盘文件）时按文件头 magic bytes 判定，
    // 避免把「路径没有后缀」误判为不支持格式。
    const mediaType = IMAGE_MEDIA_TYPES.get(path.extname(resolved).toLowerCase())
      ?? sniffImageMediaType(buffer)
    if (!mediaType) {
      throw new Error(`不支持的图片格式：${rawPath}（仅支持 png/jpg/jpeg/webp/gif）`)
    }
    const data = buffer.toString('base64')
    return { data, mediaType }
  }
}

/** 按文件头识别图片类型；无法识别返回 null。 */
function sniffImageMediaType(buffer: Buffer): string | null {
  const bytes = new Uint8Array(buffer.subarray(0, 12))
  const head = (offset: number, ...expected: number[]) =>
    expected.every((byte, index) => bytes[offset + index] === byte)
  if (head(0, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))
    return 'image/png'
  if (head(0, 0xFF, 0xD8, 0xFF))
    return 'image/jpeg'
  if (head(0, 0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61)
    return 'image/gif'
  // WebP：RIFF(4) + size(4) + WEBP(4)
  if (head(0, 0x52, 0x49, 0x46, 0x46) && head(8, 0x57, 0x45, 0x42, 0x50))
    return 'image/webp'
  return null
}

function supportsImageInput(model: ProviderConfigModelSchema): boolean {
  return model.capabilities?.inputModalities?.includes('image') === true
}

function toAgentModel(model: ProviderConfigModelSchema): AgentModel {
  return {
    id: model.id,
    model: model.model,
    name: model.name,
    providerId: model.providerId,
    contextLength: model.contextLength,
  }
}

/** 收集 streamModel 输出文本与用量。 */
async function collectModelText(
  stream: AsyncGenerator<IAIStreamChunk>,
): Promise<{ text: string, usage?: IAIStreamChunk['usage'] }> {
  let text = ''
  let usage: IAIStreamChunk['usage'] | undefined
  for await (const chunk of stream) {
    for (const part of chunk.content ?? []) {
      if (part.type === 'text')
        text += part.text
    }
    if (chunk.usage) {
      usage = chunk.usage
    }
  }
  return { text, usage }
}
