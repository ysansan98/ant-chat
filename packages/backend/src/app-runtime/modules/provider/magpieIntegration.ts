import type { ProviderConfigSchema } from '@ant-chat/shared'
import type { ClientInfo } from '../../../agent-core'
import type { KeychainSecretStore } from '../../../secretStore'
import type { ProviderIntegration, ProviderModelDefinition } from './providerIntegration'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { mapModelsDevEffortToV7 } from '@ant-chat/shared'
import { createProvider } from '../../../agent-core'

/** magpie 网关默认地址（本机回环）。 */
export const MAGPIE_DEFAULT_BASE_URL = 'http://127.0.0.1:3425/v1'

/** 网关默认端口；`settings.json` 未给出端口时使用。 */
export const MAGPIE_DEFAULT_PORT = 3425

/**
 * 用量归属标识：magpie 按 `Authorization: Bearer magpie-<appid>` 把请求记在应用名下。
 * 本机网关接受任意 key，用户不填密钥时用这个默认值。
 */
export const MAGPIE_DEFAULT_API_KEY = 'magpie-ant-chat'

/** 单次 HTTP 请求超时：本机网关响应很快，超时即视为不可用。 */
const REQUEST_TIMEOUT_MS = 10_000

/** 探测超时：比普通请求更短，避免设置页等待。 */
const PROBE_TIMEOUT_MS = 2_000

/** `/v1/models` 的 `modalities.input` 中我们认识的取值。 */
const INPUT_MODALITIES = new Set(['text', 'image', 'pdf', 'video', 'audio'])

export interface MagpieIntegrationDeps {
  /** 凭据访问：复用 KeychainSecretStore 的 provider apiKey 路径。 */
  credentialStore: Pick<KeychainSecretStore, 'getProviderApiKey' | 'saveProviderApiKey' | 'deleteProviderApiKey'>
  clientInfo?: ClientInfo
}

export interface MagpieIntegrationOptions {
  fetchImpl?: typeof fetch
  /** magpie `settings.json` 候选路径；默认按平台推导。 */
  configPaths?: string[]
  /** 读取配置文件文本；返回 null 表示不存在或不可读。默认读磁盘。 */
  readSettingsFile?: (filePath: string) => Promise<string | null>
}

/**
 * Magpie Integration：把本机 magpie 网关当成一个 OpenAI 兼容服务商。
 *
 * 网关地址由用户配置（默认 `http://127.0.0.1:3425/v1`），模型目录实时来自
 * `GET /v1/models` —— 用户在 magpie 里增删供应商后，重新同步即可看到。
 */
export function createMagpieProviderIntegration(
  deps: MagpieIntegrationDeps,
  options: MagpieIntegrationOptions = {},
): ProviderIntegration {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const configPaths = options.configPaths ?? resolveMagpieConfigPaths()
  const readSettingsFile = options.readSettingsFile ?? defaultReadSettingsFile

  const resolveApiKey = async (provider: ProviderConfigSchema): Promise<string> =>
    (await deps.credentialStore.getProviderApiKey(provider.id)) ?? MAGPIE_DEFAULT_API_KEY

  /** 探测候选地址：用户配置 → settings.json 的 port → 默认 3425。 */
  const resolveBaseUrlCandidates = async (configuredBaseUrl?: string): Promise<string[]> => {
    const candidates: string[] = []
    if (configuredBaseUrl) {
      candidates.push(configuredBaseUrl)
    }
    const port = await readConfiguredPort(readSettingsFile, configPaths)
    if (port !== null) {
      candidates.push(`http://127.0.0.1:${port}/v1`)
    }
    candidates.push(MAGPIE_DEFAULT_BASE_URL)
    return [...new Set(candidates)]
  }

  return {
    descriptor: { label: 'Magpie', defaultApiMode: 'openai', fixedApiMode: 'openai' },
    capabilities: {
      authentication: 'api-key',
      modelSource: 'provider',
      localAuthImport: false,
      // magpie 有 /v1/magpie/quotas，但额度展示尚未接入，不假装支持。
      usage: 'none',
      endpoint: 'custom',
    },
    modelSource: {
      async listModels(provider) {
        const apiKey = await resolveApiKey(provider)
        return await fetchMagpieModels({ fetchImpl, baseUrl: provider.baseUrl, apiKey })
      },
    },
    validateConfig(provider) {
      if (provider.integrationId !== 'magpie') {
        throw new Error(`Magpie Integration 不接受 ${provider.integrationId} 配置。`)
      }
      if (provider.apiMode !== 'openai') {
        throw new Error('Magpie 仅支持 openai wire protocol。')
      }
      if (!isHttpUrl(provider.baseUrl)) {
        throw new Error('Magpie 需要一个 http(s) 的 API 地址。')
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
      return await createProvider({ ...provider, apiKey: await resolveApiKey(provider) }, { clientInfo: deps.clientInfo })
    },
    async probe(provider) {
      for (const candidate of await resolveBaseUrlCandidates(provider?.baseUrl)) {
        const version = await probeMagpieHello({ fetchImpl, baseUrl: candidate })
        if (version !== null) {
          return { id: 'magpie', label: 'Magpie', available: true, version, baseUrl: candidate }
        }
      }
      return { id: 'magpie', label: 'Magpie', available: false }
    },
  }
}

/**
 * magpie `settings.json` 的候选路径。
 *
 * magpie 自己按 `XDG_CONFIG_HOME` 解析配置目录，各平台的用户配置目录形态不同，
 * 这里按"最可能命中"的顺序全部列出，读取失败直接跳过。该文件只读，绝不写入。
 */
export function resolveMagpieConfigPaths(
  env: Record<string, string | undefined> = process.env,
  homeDir: string = os.homedir(),
): string[] {
  const candidates = [
    env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, 'magpie', 'settings.json') : null,
    path.join(homeDir, '.config', 'magpie', 'settings.json'),
    path.join(homeDir, 'Library', 'Application Support', 'magpie', 'settings.json'),
    env.APPDATA ? path.join(env.APPDATA, 'magpie', 'settings.json') : null,
  ]
  return [...new Set(candidates.filter((item): item is string => Boolean(item)))]
}

async function defaultReadSettingsFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  }
  catch {
    // 文件不存在、无权限、或不是普通文件：都视为"没有这个候选"。
    return null
  }
}

/** 依次读候选配置，返回第一个合法的 `port`；都不合法时返回 null。 */
export async function readConfiguredPort(
  readFile: (filePath: string) => Promise<string | null>,
  configPaths: string[],
): Promise<number | null> {
  for (const filePath of configPaths) {
    const text = await readFile(filePath)
    if (text === null) {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(text)
      const port = isRecord(parsed) ? parsed.port : undefined
      if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535) {
        return port
      }
    }
    catch {
      // 非法 JSON 继续看下一个候选，不让探测失败。
    }
  }
  return null
}

/** `GET /api/hello` 探测：确认对端是 magpie，返回版本号。 */
async function probeMagpieHello(
  input: { fetchImpl: typeof fetch, baseUrl: string },
): Promise<string | null> {
  const origin = toOrigin(input.baseUrl)
  if (!origin) {
    return null
  }
  try {
    const response = await input.fetchImpl(`${origin}/api/hello`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) {
      return null
    }
    const data: unknown = await response.json()
    if (!isRecord(data) || data.name !== 'magpie') {
      return null
    }
    return typeof data.version === 'string' && data.version.length > 0 ? data.version : 'unknown'
  }
  catch {
    // 未运行、端口被占用、响应不是 JSON：统一视为"未检测到"。
    return null
  }
}

/** 拉取并映射 `/v1/models`；失败抛出可读中文错误。 */
export async function fetchMagpieModels(
  input: { fetchImpl: typeof fetch, baseUrl: string, apiKey: string },
): Promise<ProviderModelDefinition[]> {
  const url = `${input.baseUrl.replace(/\/+$/, '')}/models`
  let response: Response
  try {
    response = await input.fetchImpl(url, {
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`无法连接 magpie 网关（${input.baseUrl}）：请确认 magpie 正在运行，或在服务商设置里修改 API 地址。（${detail}）`)
  }

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(`magpie 拒绝了请求（HTTP ${response.status}）：请在设置页检查该服务商的 API Key。`)
    }
    throw new Error(`magpie 模型目录请求失败（HTTP ${response.status}）：${truncate(text, 200)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  }
  catch {
    throw new Error(`magpie 返回了无法解析的模型目录：${truncate(text, 200)}`)
  }

  const data = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : null
  if (!data) {
    throw new Error(`magpie 模型目录格式不符合预期：${truncate(text, 200)}`)
  }

  const models: ProviderModelDefinition[] = []
  for (const entry of data) {
    const model = toProviderModelDefinition(entry)
    if (model) {
      models.push(model)
    }
  }
  if (models.length === 0) {
    throw new Error('magpie 当前没有可用模型：请在 magpie 里启用至少一个供应商或模型后再同步。')
  }
  return models
}

/** 把 `/v1/models` 的单条记录映射为 Provider 模型定义；缺字段走回退，未知字段丢弃。 */
export function toProviderModelDefinition(entry: unknown): ProviderModelDefinition | null {
  if (!isRecord(entry)) {
    return null
  }
  const id = typeof entry.id === 'string' ? entry.id.trim() : ''
  if (!id) {
    return null
  }
  const displayName = typeof entry.display_name === 'string' ? entry.display_name.trim() : ''
  const contextLength = firstPositiveNumber(entry.context_window, entry.context_length)
  const maxOutputTokens = firstPositiveNumber(entry.max_output_tokens)
  const reasoningLevels = readReasoningLevels(entry.supported_reasoning_levels)
  const inputModalities = readInputModalities(entry.modalities)

  return {
    id,
    name: displayName || id,
    ...(contextLength !== undefined ? { contextLength } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    capabilities: {
      reasoning: entry.reasoning === true || (reasoningLevels?.length ?? 0) > 0,
      ...(reasoningLevels ? { reasoningLevels } : {}),
      ...(inputModalities ? { inputModalities } : {}),
    },
  }
}

function readReasoningLevels(raw: unknown) {
  if (!Array.isArray(raw)) {
    return undefined
  }
  const efforts = raw
    .map(item => (isRecord(item) && typeof item.effort === 'string' ? item.effort : ''))
    .filter(effort => effort.length > 0)
  return mapModelsDevEffortToV7(efforts)
}

function readInputModalities(raw: unknown): Array<'text' | 'image' | 'pdf' | 'video' | 'audio'> | undefined {
  const input = isRecord(raw) && Array.isArray(raw.input) ? raw.input : null
  if (!input) {
    return undefined
  }
  const values = input.filter((item): item is 'text' | 'image' | 'pdf' | 'video' | 'audio' =>
    typeof item === 'string' && INPUT_MODALITIES.has(item))
  return values.length > 0 ? values : undefined
}

function firstPositiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value
    }
  }
  return undefined
}

/** 取 API 地址的 origin（`http://127.0.0.1:3425/v1` → `http://127.0.0.1:3425`）。 */
function toOrigin(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).origin
  }
  catch {
    return null
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
