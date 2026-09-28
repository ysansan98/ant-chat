import type { ModelsDevModel, ProviderConfigSchema } from '@ant-chat/shared'
import type { ClientInfo } from '../../../agent-core'
import type { KeychainSecretStore } from '../../../secretStore'
import type { MediaGenerationRequest, MediaGenerationResult, MediaGenerator, ProviderIntegration, ProviderModelDefinition } from './providerIntegration'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createProvider } from '../../../agent-core'
import { resolveProviderApiKey } from './index'
import { createModelsDevModelSource } from './providerIntegration'

/** ModelScope API-Inference 固定 endpoint。 */
export const MODELSCOPE_BASE_URL = 'https://api-inference.modelscope.cn/v1'

/** models.dev 目录里的 provider key（integration 厂商专属，与用户创建的 provider id 无关）。 */
const MODELSCOPE_MODELS_DEV_KEY = 'modelscope'

/** 首次轮询延迟：避免提交后立刻空转（官方示例 5s、第三方实现 2s，取中为 3s）。 */
const POLL_INITIAL_DELAY_MS = 3_000
/** 轮询间隔（固定）。 */
const POLL_INTERVAL_MS = 3_000
/** 单次请求超时：覆盖提交与每次状态查询。 */
const REQUEST_TIMEOUT_MS = 30_000
/** 产物下载超时：独立计时，不与轮询共享。 */
const DOWNLOAD_TIMEOUT_MS = 60_000

/** 内置精选生图清单（可用性以真机验证为准），随「同步模型」写入 models 表。 */
export const MODELSCOPE_BUILTIN_IMAGE_MODELS: ProviderModelDefinition[] = [
  { id: 'Qwen/Qwen-Image', name: 'Qwen-Image', capabilities: { outputModalities: ['image'] } },
  { id: 'Tongyi-MAI/Z-Image-Turbo', name: 'Z-Image-Turbo', capabilities: { outputModalities: ['image'] } },
]

/**
 * 成功/失败状态词表：官方示例为 `SUCCEED`；兼容第三方实现归纳的
 * `success/completed/done` 与 `failed/error/canceled` 变体（统一小写比较）。
 */
const SUCCESS_STATUS = new Set(['succeed', 'succeeded', 'success', 'completed', 'done'])
const FAILED_STATUS = new Set(['failed', 'fail', 'error', 'canceled', 'cancelled'])

export interface ModelScopeIntegrationDeps {
  /** models.dev 的 modelscope chat 模型（composition root 注入，复用缓存并便于测试）。 */
  listModelsDevModels: (providerId: string) => Promise<ModelsDevModel[]>
  /** 凭据访问：复用 KeychainSecretStore 的 provider apiKey 路径。 */
  credentialStore: Pick<KeychainSecretStore, 'getProviderApiKey' | 'saveProviderApiKey' | 'deleteProviderApiKey'>
  clientInfo?: ClientInfo
}

export interface ModelScopeIntegrationOptions {
  fetchImpl?: typeof fetch
  now?: () => number
  /** 轮询等待注入点（测试用 fake timer 驱动）。 */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

/**
 * ModelScope（魔搭）Integration：固定 endpoint + API Key 认证。
 *
 * chat 走 models.dev 模型源 + 通用 `createProvider`；生图走自有异步协议
 * （submit + poll + 下载产物），对上层暴露为带 AbortSignal 的 Promise。
 */
export function createModelScopeProviderIntegration(
  deps: ModelScopeIntegrationDeps,
  options: ModelScopeIntegrationOptions = {},
): ProviderIntegration {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultSleep

  const modelsDevSource = createModelsDevModelSource(deps.listModelsDevModels)

  return {
    descriptor: { label: 'ModelScope', defaultApiMode: 'openai', fixedApiMode: 'openai' },
    capabilities: {
      authentication: 'api-key',
      modelSource: 'provider',
      localAuthImport: false,
      usage: 'none', // 额度查询接口未知，不假装支持
      endpoint: 'fixed',
      fixedBaseUrl: MODELSCOPE_BASE_URL,
    },
    modelSource: {
      async listModels(provider) {
        // models.dev 的 chat 模型 + 内置生图清单合并；models.dev 没有生图模型目录。
        // 目录查询固定用 models.dev 的 modelscope key：用户手动创建的 provider 是随机 id，
        // 拿它当目录 key 会查不到 chat 模型。
        const chatModels = await modelsDevSource.listModels({ ...provider, id: MODELSCOPE_MODELS_DEV_KEY })
        const known = new Set(chatModels.map(item => item.id))
        const builtin = MODELSCOPE_BUILTIN_IMAGE_MODELS.filter(item => !known.has(item.id))
        return [...chatModels, ...builtin]
      },
    },
    validateConfig(provider) {
      if (provider.integrationId !== 'modelscope') {
        throw new Error(`ModelScope Integration 不接受 ${provider.integrationId} 配置。`)
      }
      if (provider.apiMode !== 'openai') {
        throw new Error('ModelScope 仅支持 openai wire protocol。')
      }
      if (provider.baseUrl !== MODELSCOPE_BASE_URL) {
        throw new Error('ModelScope 使用固定 endpoint，不可自定义。')
      }
    },
    async prepareRevoke(provider) {
      const previous = await deps.credentialStore.getProviderApiKey(provider.id)
      return {
        commit: () => deps.credentialStore.deleteProviderApiKey(provider.id),
        rollback: async () => {
          if (previous === null) {
            await deps.credentialStore.deleteProviderApiKey(provider.id)
          }
          else {
            await deps.credentialStore.saveProviderApiKey({ providerId: provider.id, apiKey: previous })
          }
        },
      }
    },
    async createAIProvider(provider) {
      const apiKey = await resolveProviderApiKey(deps.credentialStore, provider)
      return await createProvider({ ...provider, apiKey }, { clientInfo: deps.clientInfo })
    },
    mediaGeneration: {
      image: provider => new ModelScopeAsyncImageGenerator(provider, {
        fetchImpl,
        now,
        sleep,
        getApiKey: async () => {
          try {
            return await resolveProviderApiKey(deps.credentialStore, provider)
          }
          catch (error) {
            // 生图产物交付依赖凭据可用；这里的错误要指向设置页，而不是上游 401。
            const detail = error instanceof Error ? error.message : String(error)
            throw new Error(`ModelScope API Key 不可用：请在设置页配置后重试（${detail}）`)
          }
        },
      }),
    },
  }
}

export interface ModelScopeGeneratorDeps {
  fetchImpl: typeof fetch
  now: () => number
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
  getApiKey: () => Promise<string>
}

/**
 * ModelScope 异步生图 generator：submit → poll → 下载产物。
 *
 * - 首次轮询延迟 3s、间隔 3s；单次请求 30s、下载 60s
 * - 总超时不设默认值：`request.timeoutMs` 由调用方传入，未传时依赖 AbortSignal 取消
 * - 失败分类给出可读中文错误，不谎报成功
 */
export class ModelScopeAsyncImageGenerator implements MediaGenerator {
  constructor(
    private readonly provider: ProviderConfigSchema,
    private readonly deps: ModelScopeGeneratorDeps,
  ) {}

  async generate(request: MediaGenerationRequest): Promise<MediaGenerationResult> {
    const startedAt = this.deps.now()
    if (!request.outputDir?.trim()) {
      throw new Error('缺少产物目录（outputDir）：由调用方显式传入')
    }
    const apiKey = await this.deps.getApiKey()

    let taskId: string | undefined
    const totalScope = createAbortScope(request.signal, request.timeoutMs, () => taskId
      ? `生图任务超时（超过 ${request.timeoutMs}ms）：任务 ${taskId} 可能仍在上游执行，可稍后重试。`
      : `生图请求超时（超过 ${request.timeoutMs}ms）。`)
    try {
      taskId = await this.submitTask(request, apiKey, totalScope.signal)
      const outputUrls = await this.pollTask(taskId, apiKey, totalScope.signal)
      const files = await this.downloadAll(outputUrls, request, apiKey, totalScope.signal)
      return {
        providerId: this.provider.id,
        modelId: request.model,
        files,
        taskId,
        elapsedMs: this.deps.now() - startedAt,
      }
    }
    finally {
      totalScope.dispose()
    }
  }

  /** 提交异步任务，返回 task_id。 */
  private async submitTask(request: MediaGenerationRequest, apiKey: string, parentSignal: AbortSignal): Promise<string> {
    const scope = createAbortScope(parentSignal, REQUEST_TIMEOUT_MS, () => '提交生图任务超时（30s）。')
    try {
      const response = await this.requestJson(`${this.provider.baseUrl}/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-ModelScope-Async-Mode': 'true',
          'X-ModelScope-Task-Type': 'image_generation',
        },
        body: JSON.stringify(buildSubmitBody(request)),
      }, scope.signal)
      if (!response.ok) {
        throw describeHttpError(response.status, response.text)
      }
      const taskId = response.data?.task_id
      if (typeof taskId !== 'string' || !taskId) {
        throw new Error(`ModelScope 未返回 task_id：${truncate(response.text, 200)}`)
      }
      return taskId
    }
    finally {
      scope.dispose()
    }
  }

  /** 轮询任务直到成功，返回产物 URL 列表；FAILED 带上游消息。 */
  private async pollTask(taskId: string, apiKey: string, parentSignal: AbortSignal): Promise<string[]> {
    const statusUrl = `${this.provider.baseUrl}/tasks/${encodeURIComponent(taskId)}`
    let delayMs = POLL_INITIAL_DELAY_MS
    while (true) {
      await this.deps.sleep(delayMs, parentSignal)
      delayMs = POLL_INTERVAL_MS

      const scope = createAbortScope(parentSignal, REQUEST_TIMEOUT_MS, () => `查询生图任务状态超时（30s）：${taskId}`)
      let response: JsonResponse
      try {
        response = await this.requestJson(statusUrl, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'X-ModelScope-Task-Type': 'image_generation',
          },
        }, scope.signal)
      }
      finally {
        scope.dispose()
      }
      if (!response.ok) {
        throw describeHttpError(response.status, response.text)
      }

      const status = String(response.data?.task_status ?? '').toLowerCase()
      if (SUCCESS_STATUS.has(status)) {
        return extractOutputImages(response.data, taskId)
      }
      if (FAILED_STATUS.has(status)) {
        const detail = pickString(response.data, 'message') ?? pickString(response.data, 'error') ?? status
        throw new Error(`ModelScope 生图任务失败（${taskId}）：${detail}`)
      }
      // PENDING / RUNNING / QUEUED 等中间状态继续轮询。
    }
  }

  /** 下载全部产物并写入 outputDir；同名文件加序号，不覆盖。 */
  private async downloadAll(
    urls: string[],
    request: MediaGenerationRequest,
    apiKey: string,
    parentSignal: AbortSignal,
  ): Promise<MediaGenerationResult['files']> {
    const outputDir = path.resolve(request.outputDir)
    await fs.mkdir(outputDir, { recursive: true })
    const baseName = `${formatTimestamp(this.deps.now())}-${slugifyPrompt(request.prompt)}`

    const files: MediaGenerationResult['files'] = []
    for (const url of urls) {
      const scope = createAbortScope(parentSignal, DOWNLOAD_TIMEOUT_MS, () => `下载产物超时（60s）：${url}`)
      let buffer: Buffer
      let extension: string
      let mediaType: string
      try {
        let response: Response
        try {
          response = await this.deps.fetchImpl(url, {
            headers: downloadHeaders(url, apiKey, this.provider.baseUrl),
            signal: scope.signal,
          })
        }
        catch (error) {
          throw normalizeAbortError(error, scope.signal)
        }
        if (!response.ok) {
          throw new Error(`产物下载失败（HTTP ${response.status}）：${url}`)
        }
        buffer = Buffer.from(await response.arrayBuffer())
        const contentType = response.headers.get('content-type')
        extension = resolveExtension(url, contentType)
        mediaType = resolveMediaType(contentType, extension)
      }
      finally {
        scope.dispose()
      }
      const written = await writeUniqueFile(outputDir, baseName, extension, buffer)
      files.push({ path: written.path, mediaType, bytes: written.bytes })
    }
    return files
  }

  /** 单次 JSON 请求：30s 级超时由调用方 scope 控制；解析失败保留原文用于报错。 */
  private async requestJson(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<JsonResponse> {
    let response: Response
    try {
      response = await this.deps.fetchImpl(url, { ...init, signal })
    }
    catch (error) {
      throw normalizeAbortError(error, signal)
    }
    const text = await response.text()
    return { ok: response.ok, status: response.status, text, data: parseJsonRecord(text) }
  }
}

interface JsonResponse {
  ok: boolean
  status: number
  text: string
  data: Record<string, unknown> | null
}

/** 组装提交请求体：尺寸按厂商格式转换，其余可选参数有值才携带。 */
function buildSubmitBody(request: MediaGenerationRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: request.model, prompt: request.prompt }
  if (request.width && request.height) {
    body.size = `${request.width}x${request.height}`
  }
  if (request.negativePrompt) {
    body.negative_prompt = request.negativePrompt
  }
  if (request.steps !== undefined) {
    body.steps = request.steps
  }
  if (request.guidance !== undefined) {
    body.guidance = request.guidance
  }
  if (request.seed !== undefined) {
    body.seed = request.seed
  }
  return body
}

function extractOutputImages(data: Record<string, unknown> | null, taskId: string): string[] {
  const images = data?.output_images
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error(`ModelScope 任务成功但未返回产物（${taskId}）`)
  }
  const urls = images.filter((item): item is string => typeof item === 'string' && item.length > 0)
  if (urls.length === 0) {
    throw new Error(`ModelScope 任务成功但产物不是有效 URL（${taskId}）`)
  }
  return urls
}

/** HTTP 失败分类：401/429 给出配置与额度提示，其余带状态码与响应片段。 */
function describeHttpError(status: number, bodyText: string): Error {
  if (status === 401) {
    return new Error('ModelScope 拒绝了请求（HTTP 401）：API Key 无效或未配置，请在设置页配置 ModelScope 的 API Key。')
  }
  if (status === 429) {
    return new Error('ModelScope 请求过于频繁或当日免费额度可能已用尽（HTTP 429），请稍后重试。')
  }
  return new Error(`ModelScope 请求失败（HTTP ${status}）：${truncate(bodyText, 200)}`)
}

/** 产物 URL 与 API 同 host 时携带凭据；跨 host（CDN/OSS）不泄漏 token。 */
function downloadHeaders(url: string, apiKey: string, baseUrl: string): Record<string, string> {
  try {
    if (new URL(url).hostname === new URL(baseUrl).hostname) {
      return { Authorization: `Bearer ${apiKey}` }
    }
  }
  catch {
    // 非法 URL 交给 fetch 报错。
  }
  return {}
}

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

function resolveExtension(url: string, contentType: string | null): string {
  try {
    const fromUrl = path.extname(new URL(url).pathname).toLowerCase()
    if (/^\.[a-z0-9]{1,5}$/.test(fromUrl)) {
      return fromUrl
    }
  }
  catch {
    // URL 解析失败时回退到 Content-Type。
  }
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase()
  return (normalized && EXTENSION_BY_MEDIA_TYPE[normalized]) || '.png'
}

function resolveMediaType(contentType: string | null, extension: string): string {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase()
  if (normalized?.startsWith('image/')) {
    return normalized
  }
  const matched = Object.entries(EXTENSION_BY_MEDIA_TYPE).find(([, ext]) => ext === extension)
  return matched?.[0] ?? 'image/png'
}

/** 文件名 `<timestamp>-<prompt slug>.<ext>`；同目录同名时加序号，不覆盖已有文件。 */
async function writeUniqueFile(
  dir: string,
  baseName: string,
  extension: string,
  data: Buffer,
): Promise<{ path: string, bytes: number }> {
  let counter = 0
  while (true) {
    const suffix = counter === 0 ? '' : `-${counter}`
    const candidate = path.join(dir, `${baseName}${suffix}${extension}`)
    try {
      await fs.writeFile(candidate, data, { flag: 'wx' })
      return { path: candidate, bytes: data.byteLength }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      counter += 1
    }
  }
}

/** 从 prompt 生成文件名片段：保留字母/数字/中文，其余折叠为 '-'。 */
function slugifyPrompt(prompt: string): string {
  const slug = prompt
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || 'image'
}

/** 本地时间戳 `YYYYMMDD-HHmmss`。 */
function formatTimestamp(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join('-')
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  }
  catch {
    return null
  }
}

function pickString(data: Record<string, unknown> | null, key: string): string | undefined {
  const value = data?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 超时中断错误：携带可读消息的 abort reason。 */
class TimeoutAbortError extends Error {}

interface AbortScope {
  signal: AbortSignal
  dispose: () => void
}

/**
 * 组合父级取消与超时的 AbortSignal 作用域。
 *
 * - 父级已取消时立即跟随（沿用其 abort reason）
 * - 超时时以 `TimeoutAbortError`（惰性求值的可读消息）作为 abort reason
 */
function createAbortScope(
  parent: AbortSignal | undefined,
  timeoutMs: number | undefined,
  timeoutMessage: () => string,
): AbortScope {
  const controller = new AbortController()
  const onParentAbort = () => controller.abort(parent?.reason)
  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason)
    }
    else {
      parent.addEventListener('abort', onParentAbort, { once: true })
    }
  }
  const timer = timeoutMs !== undefined
    ? setTimeout(() => controller.abort(new TimeoutAbortError(timeoutMessage())), timeoutMs)
    : undefined
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) {
        clearTimeout(timer)
      }
      parent?.removeEventListener('abort', onParentAbort)
    },
  }
}

/** 把 abort 原因还原为可读 Error；非 abort 错误原样返回。 */
function normalizeAbortError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted && signal.reason instanceof Error) {
    return signal.reason
  }
  if (error instanceof Error) {
    return error
  }
  return new Error(String(error))
}

/** 默认轮询等待：abort 时立刻结束，不残留计时器。 */
function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(normalizeAbortError(undefined, signal))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(normalizeAbortError(undefined, signal))
    }, { once: true })
  })
}
