import type { ProviderConfigModelSchema, ProviderConfigSchema } from '@ant-chat/shared'
import type { MediaGenerator } from '../../provider/providerIntegration'
import { describe, expect, it, vi } from 'vitest'
import { GenerationModule } from '../index'

function createProvider(): ProviderConfigSchema {
  return {
    id: 'modelscope',
    name: 'ModelScope',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    apiMode: 'openai',
    integrationId: 'modelscope',
    isOfficial: false,
    isEnabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

function createModel(outputModalities?: Array<'text' | 'image' | 'video' | 'audio' | 'pdf'>): ProviderConfigModelSchema {
  return {
    id: 'Qwen/Qwen-Image',
    model: 'Qwen/Qwen-Image',
    name: 'Qwen-Image',
    isBuiltin: true,
    isEnabled: true,
    maxOutputTokens: 4096,
    contextLength: 4096,
    temperature: 0.7,
    capabilities: outputModalities ? { outputModalities } : undefined,
    cost: undefined,
    providerId: 'modelscope',
    createdAt: 0,
  } as unknown as ProviderConfigModelSchema
}

function createModule(options: {
  settings?: Record<string, string>
  model?: ProviderConfigModelSchema
  generator?: MediaGenerator | undefined
} = {}) {
  const generator = 'generator' in options ? options.generator : { generate: vi.fn() }
  return {
    generator,
    module: new GenerationModule({
      providerSettingsRepository: {
        getProviderById: vi.fn(() => createProvider()),
        listProviderModels: vi.fn(() => [options.model ?? createModel(['image'])]),
      } as never,
      settingsRepository: {
        getGeneralSettings: vi.fn(async () => ({
          imageGenProviderId: 'modelscope',
          imageGenModelId: 'Qwen/Qwen-Image',
          ...options.settings,
        })),
      } as never,
      resolveMediaGenerator: vi.fn(() => generator as MediaGenerator | undefined),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    }),
  }
}

describe('generationModule.generateImage', () => {
  it('未配置图像生成模型时报可读错误并提示设置页', async () => {
    const { module } = createModule({ settings: { imageGenProviderId: '', imageGenModelId: '' } })

    await expect(module.generateImage({ prompt: '猫', outputDir: './generated' }))
      .rejects
      .toThrow('未配置图像生成模型；请先在设置页配置图像生成模型')
  })

  it('模型未标注 image 输出能力时拒绝生成', async () => {
    const { module } = createModule({ model: createModel(['text']) })

    await expect(module.generateImage({ prompt: '猫', outputDir: './generated' }))
      .rejects
      .toThrow('不支持图像生成')
  })

  it('integration 未声明生图能力时 fail closed', async () => {
    const { module } = createModule({ generator: undefined })

    await expect(module.generateImage({ prompt: '猫', outputDir: './generated' }))
      .rejects
      .toThrow('不支持图像生成')
  })

  it('产物目录为相对路径时拒绝：后端不解析相对路径，由调用方按自身 cwd 解析', async () => {
    const { module } = createModule()

    await expect(module.generateImage({ prompt: '猫', outputDir: './generated' }))
      .rejects
      .toThrow('产物目录必须是绝对路径')
  })

  it('把模型、尺寸、绝对产物目录、超时与取消信号透传给 generator', async () => {
    const generate = vi.fn(async () => ({
      providerId: 'modelscope',
      modelId: 'Qwen/Qwen-Image',
      files: [{ path: '/tmp/generated/a.png', mediaType: 'image/png', bytes: 3 }],
      taskId: 'task-1',
      elapsedMs: 12_000,
    }))
    const { module } = createModule({ generator: { generate } })
    const controller = new AbortController()

    const result = await module.generateImage({
      prompt: '一只猫',
      width: 1024,
      height: 1024,
      // CLI 已在自身 cwd 解析为绝对路径后传入；后端原样透传。
      outputDir: '/tmp/generated-out',
      timeoutMs: 300_000,
      signal: controller.signal,
    })

    expect(generate).toHaveBeenCalledWith({
      model: 'Qwen/Qwen-Image',
      prompt: '一只猫',
      width: 1024,
      height: 1024,
      outputDir: '/tmp/generated-out',
      timeoutMs: 300_000,
      signal: controller.signal,
    })
    expect(result).toMatchObject({
      providerId: 'modelscope',
      modelId: 'Qwen/Qwen-Image',
      taskId: 'task-1',
      elapsedMs: 12_000,
    })
  })
})
