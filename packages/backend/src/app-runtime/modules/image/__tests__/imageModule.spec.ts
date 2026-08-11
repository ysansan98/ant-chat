import type { AgentModel, AIProviderFactory, IAIProvider, ProviderConfigModelSchema, ProviderConfigSchema } from '@ant-chat/shared'
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ImageModule } from '../index'

/** 1x1 红色 PNG。 */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function createProvider(id = 'provider-1'): ProviderConfigSchema {
  return {
    id,
    name: 'Test Provider',
    baseUrl: 'https://api.example.com/v1',
    apiMode: 'openai',
    integrationId: 'api-key',
    isOfficial: false,
    isEnabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

function createModel(modelId: string, inputModalities: string[] = ['text', 'image']): ProviderConfigModelSchema {
  return {
    id: modelId,
    model: modelId,
    name: modelId,
    isBuiltin: true,
    isEnabled: true,
    maxOutputTokens: 1024,
    contextLength: 8192,
    temperature: 1,
    capabilities: { inputModalities },
    cost: undefined,
    providerId: 'provider-1',
    createdAt: 0,
  } as unknown as ProviderConfigModelSchema
}

async function writeTempImage(name = 'photo.png'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-module-'))
  const filePath = path.join(dir, name)
  await fs.writeFile(filePath, ONE_PIXEL_PNG)
  return filePath
}

describe('imageModule.recognize', () => {
  it('用默认模型识别图片并返回文本与用量', async () => {
    const filePath = await writeTempImage()
    const streamModel = vi.fn<IAIProvider['streamModel']>(async function* () {
      yield { content: [{ type: 'text', text: '一只猫' }], usage: { totalTokens: 5 } }
    })
    const aiProviderFactory: AIProviderFactory = vi.fn(async () => ({
      streamModel,
    } as unknown as IAIProvider))
    const module = new ImageModule({
      providerSettingsRepository: {
        getProviderById: vi.fn(() => createProvider()),
        listProviderModels: vi.fn(() => [createModel('vision-model')]),
      } as never,
      settingsRepository: {
        getGeneralSettings: vi.fn(async () => ({ assistantProviderId: 'provider-1', assistantModelId: 'vision-model' })),
      } as never,
      aiProviderFactory,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    })

    const result = await module.recognize({ path: filePath })

    expect(result).toMatchObject({
      providerId: 'provider-1',
      modelId: 'vision-model',
      text: '一只猫',
      usage: { totalTokens: 5 },
    })
    expect(aiProviderFactory).toHaveBeenCalledWith(expect.objectContaining({
      provider: expect.objectContaining({ id: 'provider-1' }),
      model: expect.objectContaining({ model: 'vision-model' }) as AgentModel,
    }))
    const [options] = streamModel.mock.calls[0]!
    expect(options.messages[0].content).toContainEqual(expect.objectContaining({ type: 'image' }))
  })

  it('显式 provider/model 优先于默认设置', async () => {
    const filePath = await writeTempImage()
    const aiProviderFactory: AIProviderFactory = vi.fn(async () => ({
      streamModel: vi.fn(async function* () {
        yield { content: [{ type: 'text', text: 'ok' }] }
      }),
    } as unknown as IAIProvider))
    const module = new ImageModule({
      providerSettingsRepository: {
        getProviderById: vi.fn(() => createProvider('explicit')),
        listProviderModels: vi.fn(() => [createModel('gpt-vision')]),
      } as never,
      settingsRepository: {
        getGeneralSettings: vi.fn(async () => ({ assistantProviderId: 'default', assistantModelId: 'default-model' })),
      } as never,
      aiProviderFactory,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    })

    const result = await module.recognize({ path: filePath, providerId: 'explicit', modelId: 'gpt-vision' })

    expect(result.providerId).toBe('explicit')
    expect(result.modelId).toBe('gpt-vision')
    expect(aiProviderFactory).toHaveBeenCalledWith(expect.objectContaining({
      provider: expect.objectContaining({ id: 'explicit' }),
    }))
  })

  it('配置了视觉模型时优先使用视觉模型而不是默认模型', async () => {
    const filePath = await writeTempImage()
    const aiProviderFactory: AIProviderFactory = vi.fn(async () => ({
      streamModel: vi.fn(async function* () {
        yield { content: [{ type: 'text', text: 'ok' }] }
      }),
    } as unknown as IAIProvider))
    const module = new ImageModule({
      providerSettingsRepository: {
        getProviderById: vi.fn(() => createProvider()),
        listProviderModels: vi.fn(() => [
          createModel('assistant-model', ['text']),
          createModel('vision-model'),
        ]),
      } as never,
      settingsRepository: {
        getGeneralSettings: vi.fn(async () => ({
          assistantProviderId: 'provider-1',
          assistantModelId: 'assistant-model',
          visionProviderId: 'provider-1',
          visionModelId: 'vision-model',
        })),
      } as never,
      aiProviderFactory,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    })

    const result = await module.recognize({ path: filePath })

    expect(result.modelId).toBe('vision-model')
    expect(aiProviderFactory).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.objectContaining({ model: 'vision-model' }),
    }))
  })

  it('默认模型不支持图片输入时报错', async () => {
    const filePath = await writeTempImage()
    const module = new ImageModule({
      providerSettingsRepository: {
        getProviderById: vi.fn(() => createProvider()),
        listProviderModels: vi.fn(() => [createModel('text-model', ['text'])]),
      } as never,
      settingsRepository: {
        getGeneralSettings: vi.fn(async () => ({ assistantProviderId: 'provider-1', assistantModelId: 'text-model' })),
      } as never,
      aiProviderFactory: vi.fn() as never,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    })

    await expect(module.recognize({ path: filePath })).rejects.toThrow('不支持图片输入')
  })

  it('无扩展名的附件文件按 magic bytes 识别图片类型', async () => {
    // 附件落盘文件没有扩展名（如 <attachments>/<xx>/<file_id>），按文件头判定类型。
    const filePath = await writeTempImage('att-abc123')
    const streamModel = vi.fn<IAIProvider['streamModel']>(async function* () {
      yield { content: [{ type: 'text', text: 'ok' }] }
    })
    const aiProviderFactory: AIProviderFactory = vi.fn(async () => ({
      streamModel,
    } as unknown as IAIProvider))
    const module = new ImageModule({
      providerSettingsRepository: {
        getProviderById: vi.fn(() => createProvider()),
        listProviderModels: vi.fn(() => [createModel('vision-model')]),
      } as never,
      settingsRepository: {
        getGeneralSettings: vi.fn(async () => ({ assistantProviderId: 'provider-1', assistantModelId: 'vision-model' })),
      } as never,
      aiProviderFactory,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    })

    await module.recognize({ path: filePath })

    const [options] = streamModel.mock.calls[0]!
    expect(options.messages[0].content).toContainEqual(expect.objectContaining({
      type: 'image',
      mimeType: 'image/png',
    }))
  })

  it('通过 fileId 从附件存储读取图片（不经过文件系统路径）', async () => {
    const streamModel = vi.fn<IAIProvider['streamModel']>(async function* () {
      yield { content: [{ type: 'text', text: '一只狗' }] }
    })
    const aiProviderFactory: AIProviderFactory = vi.fn(async () => ({
      streamModel,
    } as unknown as IAIProvider))
    const module = new ImageModule({
      providerSettingsRepository: {
        getProviderById: vi.fn(() => createProvider()),
        listProviderModels: vi.fn(() => [createModel('vision-model')]),
      } as never,
      settingsRepository: {
        getGeneralSettings: vi.fn(async () => ({ assistantProviderId: 'provider-1', assistantModelId: 'vision-model' })),
      } as never,
      aiProviderFactory,
      loadAttachmentData: vi.fn(async () => ONE_PIXEL_PNG.toString('base64')),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    })

    const result = await module.recognize({ fileId: 'img-1' })

    expect(result.text).toBe('一只狗')
    const [options] = streamModel.mock.calls[0]!
    expect(options.messages[0].content).toContainEqual(expect.objectContaining({
      type: 'image',
      mimeType: 'image/png',
    }))
  })

  it('同时传 path 与 fileId 时 fileId 优先（附件场景不落盘路径）', async () => {
    const streamModel = vi.fn<IAIProvider['streamModel']>(async function* () {
      yield { content: [{ type: 'text', text: '附件图' }] }
    })
    const aiProviderFactory: AIProviderFactory = vi.fn(async () => ({
      streamModel,
    } as unknown as IAIProvider))
    const module = new ImageModule({
      providerSettingsRepository: {
        getProviderById: vi.fn(() => createProvider()),
        listProviderModels: vi.fn(() => [createModel('vision-model')]),
      } as never,
      settingsRepository: {
        getGeneralSettings: vi.fn(async () => ({ assistantProviderId: 'provider-1', assistantModelId: 'vision-model' })),
      } as never,
      aiProviderFactory,
      loadAttachmentData: vi.fn(async () => ONE_PIXEL_PNG.toString('base64')),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    })

    const result = await module.recognize({ path: '/no/such/file.png', fileId: 'img-1' })

    expect(result.text).toBe('附件图')
  })

  it('fileId 对应附件不存在时给出可读错误', async () => {
    const module = new ImageModule({
      providerSettingsRepository: {
        getProviderById: vi.fn(() => createProvider()),
        listProviderModels: vi.fn(() => [createModel('vision-model')]),
      } as never,
      settingsRepository: {
        getGeneralSettings: vi.fn(async () => ({ assistantProviderId: 'provider-1', assistantModelId: 'vision-model' })),
      } as never,
      aiProviderFactory: vi.fn() as never,
      loadAttachmentData: vi.fn(async () => null),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    })

    await expect(module.recognize({ fileId: 'img-missing' })).rejects.toThrow('附件不存在')
  })

  it('文件不存在、格式不支持、超过体积限制时给出可读错误', async () => {
    const module = new ImageModule({
      providerSettingsRepository: {
        getProviderById: vi.fn(() => createProvider()),
        listProviderModels: vi.fn(() => [createModel('vision-model')]),
      } as never,
      settingsRepository: {
        getGeneralSettings: vi.fn(async () => ({ assistantProviderId: 'provider-1', assistantModelId: 'vision-model' })),
      } as never,
      aiProviderFactory: vi.fn() as never,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    })

    await expect(module.recognize({ path: '/no/such/file.png' })).rejects.toThrow('图片文件不存在')

    const txtPath = await writeTempImage('note.txt')
    await fs.writeFile(txtPath, 'hello')
    await expect(module.recognize({ path: txtPath })).rejects.toThrow('不支持的图片格式')

    const bigPath = await writeTempImage('big.png')
    await fs.writeFile(bigPath, Buffer.alloc(11 * 1024 * 1024, 1))
    await expect(module.recognize({ path: bigPath })).rejects.toThrow('超过 10MB')
  })
})
