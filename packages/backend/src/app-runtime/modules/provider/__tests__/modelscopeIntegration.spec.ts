import type { ProviderConfigSchema } from '@ant-chat/shared'
import type { ModelScopeIntegrationDeps } from '../modelscopeIntegration'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModelScopeProviderIntegration, MODELSCOPE_BASE_URL } from '../modelscopeIntegration'

const provider: ProviderConfigSchema = {
  id: 'modelscope',
  name: 'ModelScope',
  baseUrl: MODELSCOPE_BASE_URL,
  apiMode: 'openai',
  integrationId: 'modelscope',
  isOfficial: false,
  isEnabled: true,
  createdAt: 0,
  updatedAt: 0,
}

const NOW_EPOCH = Date.parse('2026-09-28T12:00:00+08:00')

/** 与实现同构的本地时间戳期望，测试机时区无关。 */
function expectedTimestamp(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join('-')
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function imageResponse(bytes = [1, 2, 3]): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'image/png' } })
}

/** 立即返回的轮询等待（不消耗真实时间）。 */
const immediateSleep = vi.fn(async (_ms: number, _signal: AbortSignal) => {})

function createIntegration(
  fetchImpl: typeof fetch,
  options: { sleep?: (ms: number, signal: AbortSignal) => Promise<void>, now?: () => number } = {},
) {
  const deps: ModelScopeIntegrationDeps = {
    listModelsDevModels: vi.fn(async () => []),
    credentialStore: {
      getProviderApiKey: vi.fn(async () => 'test-key'),
      saveProviderApiKey: vi.fn(async () => ({ kind: 'secret_ref' as const, id: 'provider:modelscope:api_key', scope: 'persistent' as const })),
      deleteProviderApiKey: vi.fn(async () => {}),
    },
  }
  return createModelScopeProviderIntegration(deps, {
    fetchImpl,
    now: options.now ?? (() => NOW_EPOCH),
    sleep: options.sleep ?? immediateSleep,
  })
}

function getGenerator(integration: ReturnType<typeof createIntegration>) {
  const factory = integration.mediaGeneration?.image
  if (!factory)
    throw new Error('integration 未声明 mediaGeneration.image')
  return factory(provider)
}

describe('modelscope integration 模型源与配置校验', () => {
  it('models.dev chat 模型与内置生图清单合并，内置项标注 image 输出能力', async () => {
    const deps: ModelScopeIntegrationDeps = {
      listModelsDevModels: vi.fn(async () => [{
        id: 'Qwen/Qwen3-8B',
        name: 'Qwen3 8B',
        providerId: 'modelscope',
        model: 'Qwen/Qwen3-8B',
        contextLength: 32_000,
        maxOutputTokens: 8_000,
        toolCall: true,
        reasoning: false,
      }]),
      credentialStore: {
        getProviderApiKey: vi.fn(async () => null),
        saveProviderApiKey: vi.fn(async () => ({ kind: 'secret_ref' as const, id: 'provider:modelscope:api_key', scope: 'persistent' as const })),
        deleteProviderApiKey: vi.fn(async () => {}),
      },
    }
    const integration = createModelScopeProviderIntegration(deps)

    const models = await integration.modelSource.listModels(provider)

    expect(deps.listModelsDevModels).toHaveBeenCalledWith('modelscope')
    expect(models.map(item => item.id)).toEqual(['Qwen/Qwen3-8B', 'Qwen/Qwen-Image', 'Tongyi-MAI/Z-Image-Turbo'])
    expect(models[1].capabilities?.outputModalities).toEqual(['image'])
    expect(models[2].capabilities?.outputModalities).toEqual(['image'])
  })

  it('用户手动创建的 provider（随机 id）同步仍走 models.dev 的 modelscope 目录', async () => {
    const deps: ModelScopeIntegrationDeps = {
      listModelsDevModels: vi.fn(async () => [{
        id: 'ZhipuAI/GLM-4.6',
        name: 'GLM-4.6',
        providerId: 'modelscope',
        model: 'ZhipuAI/GLM-4.6',
        contextLength: 200_000,
        maxOutputTokens: 8_000,
        toolCall: true,
        reasoning: false,
      }]),
      credentialStore: {
        getProviderApiKey: vi.fn(async () => null),
        saveProviderApiKey: vi.fn(async () => ({ kind: 'secret_ref' as const, id: 'provider:custom:api_key', scope: 'persistent' as const })),
        deleteProviderApiKey: vi.fn(async () => {}),
      },
    }
    const integration = createModelScopeProviderIntegration(deps)

    const models = await integration.modelSource.listModels({ ...provider, id: 'provider-abc123' })

    expect(deps.listModelsDevModels).toHaveBeenCalledWith('modelscope')
    expect(models.map(item => item.id)).toEqual(['ZhipuAI/GLM-4.6', 'Qwen/Qwen-Image', 'Tongyi-MAI/Z-Image-Turbo'])
  })

  it('validateConfig 拒绝自定义 endpoint 与非 openai wire protocol', () => {
    const integration = createIntegration(vi.fn())

    expect(() => integration.validateConfig({ ...provider, baseUrl: 'https://attacker.example/v1' })).toThrow('固定 endpoint')
    expect(() => integration.validateConfig({ ...provider, apiMode: 'anthropic' })).toThrow('openai wire protocol')
    expect(() => integration.validateConfig({ ...provider, integrationId: 'api-key' })).toThrow('不接受')
    expect(() => integration.validateConfig(provider)).not.toThrow()
  })

  it('capabilities 声明固定 endpoint 与 api-key 认证', () => {
    const integration = createIntegration(vi.fn())

    expect(integration.capabilities).toEqual({
      authentication: 'api-key',
      modelSource: 'provider',
      localAuthImport: false,
      usage: 'none',
      endpoint: 'fixed',
      fixedBaseUrl: MODELSCOPE_BASE_URL,
    })
    expect(integration.mediaGeneration?.image).toBeDefined()
    expect(integration.mediaGeneration?.video).toBeUndefined()
  })
})

describe('modelscope 异步生图 generator', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
    vi.clearAllMocks()
  })

  async function createOutputDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'modelscope-gen-'))
    tempDirs.push(dir)
    return dir
  }

  it('submit → poll → 下载落盘：请求形态、文件名、耗时与 taskId', async () => {
    const outputDir = await createOutputDir()
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === `${MODELSCOPE_BASE_URL}/images/generations`) {
        return jsonResponse({ task_id: 'task-1' })
      }
      if (url === `${MODELSCOPE_BASE_URL}/tasks/task-1`) {
        return jsonResponse({ task_status: 'SUCCEED', output_images: [`${MODELSCOPE_BASE_URL}/files/result.png`] })
      }
      if (url === `${MODELSCOPE_BASE_URL}/files/result.png`) {
        return imageResponse([1, 2, 3, 4])
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const integration = createIntegration(fetchImpl)

    const result = await getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: '一只金色小猫 in the sun!',
      width: 1024,
      height: 1024,
      negativePrompt: '模糊',
      steps: 50,
      guidance: 4,
      seed: 42,
      outputDir,
    })

    // 提交请求：认证头、异步模式、task type 与参数转换
    const [submitUrl, submitInit] = fetchImpl.mock.calls[0]
    expect(String(submitUrl)).toBe(`${MODELSCOPE_BASE_URL}/images/generations`)
    expect(submitInit?.method).toBe('POST')
    const submitHeaders = new Headers(submitInit?.headers)
    expect(submitHeaders.get('Authorization')).toBe('Bearer test-key')
    expect(submitHeaders.get('X-ModelScope-Async-Mode')).toBe('true')
    expect(submitHeaders.get('X-ModelScope-Task-Type')).toBe('image_generation')
    expect(JSON.parse(String(submitInit?.body))).toEqual({
      model: 'Qwen/Qwen-Image',
      prompt: '一只金色小猫 in the sun!',
      size: '1024x1024',
      negative_prompt: '模糊',
      steps: 50,
      guidance: 4,
      seed: 42,
    })

    // 轮询请求形态
    const [pollUrl, pollInit] = fetchImpl.mock.calls[1]
    expect(String(pollUrl)).toBe(`${MODELSCOPE_BASE_URL}/tasks/task-1`)
    expect(new Headers(pollInit?.headers).get('X-ModelScope-Task-Type')).toBe('image_generation')

    // 下载：同 host 携带凭据
    const [downloadUrl, downloadInit] = fetchImpl.mock.calls[2]
    expect(String(downloadUrl)).toBe(`${MODELSCOPE_BASE_URL}/files/result.png`)
    expect(new Headers(downloadInit?.headers).get('Authorization')).toBe('Bearer test-key')

    // 落盘命名：<timestamp>-<prompt slug>.<ext>
    expect(result.taskId).toBe('task-1')
    expect(result.modelId).toBe('Qwen/Qwen-Image')
    expect(result.elapsedMs).toBe(0)
    expect(result.files).toHaveLength(1)
    expect(path.basename(result.files[0].path)).toBe(`${expectedTimestamp(NOW_EPOCH)}-一只金色小猫-in-the-sun.png`)
    expect(result.files[0].mediaType).toBe('image/png')
    expect(result.files[0].bytes).toBe(4)

    // 首次轮询延迟 3s
    expect(immediateSleep).toHaveBeenCalledWith(3_000, expect.anything())
  })

  it('上游返回 PENDING 时继续轮询，成功后返回产物；轮询间隔固定 3s', async () => {
    const outputDir = await createOutputDir()
    let pollCount = 0
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === `${MODELSCOPE_BASE_URL}/images/generations`) {
        return jsonResponse({ task_id: 'task-2' })
      }
      if (url === `${MODELSCOPE_BASE_URL}/tasks/task-2`) {
        pollCount += 1
        return pollCount === 1
          ? jsonResponse({ task_status: 'RUNNING' })
          : jsonResponse({ task_status: 'SUCCEED', output_images: [`${MODELSCOPE_BASE_URL}/files/b.png`] })
      }
      if (url.endsWith('/files/b.png')) {
        return imageResponse()
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const integration = createIntegration(fetchImpl)

    const result = await getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir,
    })

    expect(pollCount).toBe(2)
    expect(immediateSleep).toHaveBeenCalledTimes(2)
    expect(immediateSleep.mock.calls.every(([ms]) => ms === 3_000)).toBe(true)
    expect(result.files).toHaveLength(1)
  })

  it('上游任务 FAILED 时带上游消息，不谎报成功', async () => {
    const outputDir = await createOutputDir()
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === `${MODELSCOPE_BASE_URL}/images/generations`) {
        return jsonResponse({ task_id: 'task-3' })
      }
      if (url === `${MODELSCOPE_BASE_URL}/tasks/task-3`) {
        return jsonResponse({ task_status: 'FAILED', message: '内容审核未通过' })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    const integration = createIntegration(fetchImpl)

    await expect(getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir,
    })).rejects.toThrow('ModelScope 生图任务失败（task-3）：内容审核未通过')
  })

  it('上游返回 HTTP 401 时提示到设置页配置 API Key', async () => {
    const outputDir = await createOutputDir()
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'unauthorized' }, 401))
    const integration = createIntegration(fetchImpl)

    await expect(getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir,
    })).rejects.toThrow('API Key 无效或未配置')
  })

  it('上游返回 HTTP 429 时提示额度可能用尽', async () => {
    const outputDir = await createOutputDir()
    let polled = false
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === `${MODELSCOPE_BASE_URL}/images/generations`) {
        return jsonResponse({ task_id: 'task-4' })
      }
      polled = true
      return jsonResponse({ error: 'rate limited' }, 429)
    })
    const integration = createIntegration(fetchImpl)

    await expect(getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir,
    })).rejects.toThrow('当日免费额度可能已用尽')
    expect(polled).toBe(true)
  })

  it('总超时：timeoutMs 到点后停止轮询，错误带 task_id 提示', async () => {
    const outputDir = await createOutputDir()
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === `${MODELSCOPE_BASE_URL}/images/generations`) {
        return jsonResponse({ task_id: 'task-5' })
      }
      return jsonResponse({ task_status: 'PENDING' })
    })
    const integration = createIntegration(fetchImpl, {
      // 使用真实计时器等待（超时值很小，测试仍是毫秒级）
      sleep: (ms, signal) => new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(signal.reason)
        }, { once: true })
      }),
    })

    await expect(getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir,
      timeoutMs: 20,
    })).rejects.toThrow('生图任务超时（超过 20ms）：任务 task-5 可能仍在上游执行')
  })

  it('外部 AbortSignal 取消时以中止原因结束，不吞错', async () => {
    const outputDir = await createOutputDir()
    const controller = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === `${MODELSCOPE_BASE_URL}/images/generations`) {
        return jsonResponse({ task_id: 'task-6' })
      }
      return jsonResponse({ task_status: 'RUNNING' })
    })
    const integration = createIntegration(fetchImpl, {
      sleep: async (ms, signal) => {
        controller.abort(new Error('调用方已取消'))
        if (signal.aborted) {
          throw signal.reason
        }
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
    })

    await expect(getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir,
      signal: controller.signal,
    })).rejects.toThrow('调用方已取消')
  })

  it('产物下载失败单独报错，不吞掉', async () => {
    const outputDir = await createOutputDir()
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === `${MODELSCOPE_BASE_URL}/images/generations`) {
        return jsonResponse({ task_id: 'task-7' })
      }
      if (url === `${MODELSCOPE_BASE_URL}/tasks/task-7`) {
        return jsonResponse({ task_status: 'SUCCEED', output_images: [`${MODELSCOPE_BASE_URL}/files/c.png`] })
      }
      return jsonResponse({ error: 'gone' }, 500)
    })
    const integration = createIntegration(fetchImpl)

    await expect(getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir,
    })).rejects.toThrow('产物下载失败（HTTP 500）')
  })

  it('非 API host 的产物 URL 不携带 Authorization（不泄漏 token 给第三方 CDN）', async () => {
    const outputDir = await createOutputDir()
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === `${MODELSCOPE_BASE_URL}/images/generations`) {
        return jsonResponse({ task_id: 'task-8' })
      }
      if (url === `${MODELSCOPE_BASE_URL}/tasks/task-8`) {
        return jsonResponse({ task_status: 'SUCCEED', output_images: ['https://cdn.example.com/remote.png'] })
      }
      return imageResponse()
    })
    const integration = createIntegration(fetchImpl)

    await getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir,
    })

    const [, downloadInit] = fetchImpl.mock.calls[2]
    expect(new Headers(downloadInit?.headers).get('Authorization')).toBeNull()
  })

  it('同名文件存在时加序号，不覆盖已有文件', async () => {
    const outputDir = await createOutputDir()
    const existing = path.join(outputDir, `${expectedTimestamp(NOW_EPOCH)}-cat.png`)
    await writeFile(existing, new Uint8Array([9]))

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === `${MODELSCOPE_BASE_URL}/images/generations`) {
        return jsonResponse({ task_id: 'task-9' })
      }
      if (url === `${MODELSCOPE_BASE_URL}/tasks/task-9`) {
        return jsonResponse({ task_status: 'SUCCEED', output_images: [`${MODELSCOPE_BASE_URL}/files/cat.png`] })
      }
      return imageResponse([1, 2])
    })
    const integration = createIntegration(fetchImpl)

    const result = await getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir,
    })

    expect(path.basename(result.files[0].path)).toBe(`${expectedTimestamp(NOW_EPOCH)}-cat-1.png`)
    // 原文件保持原样
    expect(await readFile(existing)).toEqual(Buffer.from([9]))
  })

  it('缺少 outputDir 时快速失败，不发起任何请求', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const integration = createIntegration(fetchImpl)

    await expect(getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir: '  ',
    })).rejects.toThrow('缺少产物目录')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('未配置 API Key 时报中文错误并指引设置页', async () => {
    const outputDir = await createOutputDir()
    const fetchImpl = vi.fn<typeof fetch>()
    const integration = createModelScopeProviderIntegration({
      listModelsDevModels: vi.fn(async () => []),
      credentialStore: {
        getProviderApiKey: vi.fn(async () => null),
        saveProviderApiKey: vi.fn(async () => ({ kind: 'secret_ref' as const, id: 'provider:modelscope:api_key', scope: 'persistent' as const })),
        deleteProviderApiKey: vi.fn(async () => {}),
      },
    }, { fetchImpl, now: () => NOW_EPOCH, sleep: immediateSleep })

    await expect(getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir,
    })).rejects.toThrow('ModelScope API Key 不可用：请在设置页配置后重试')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('任务成功但无产物 URL 时报错', async () => {
    const outputDir = await createOutputDir()
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url === `${MODELSCOPE_BASE_URL}/images/generations`) {
        return jsonResponse({ task_id: 'task-10' })
      }
      return jsonResponse({ task_status: 'SUCCEED', output_images: [] })
    })
    const integration = createIntegration(fetchImpl)

    await expect(getGenerator(integration).generate({
      model: 'Qwen/Qwen-Image',
      prompt: 'cat',
      outputDir,
    })).rejects.toThrow('未返回产物')
  })
})
