import type { ModelsDevModel, ModelsDevProvider, ProviderFormat } from '@ant-chat/shared'

const MODELS_DEV_URL = 'https://models.dev/api.json'

interface ModelsDevModelEntry {
  id: string
  name?: string
  tool_call?: boolean
  reasoning?: boolean
  modalities?: { input?: string[] }
  limit?: { context?: number, output?: number }
}

interface ModelsDevProviderEntry {
  id: string
  name?: string
  api?: string
  npm?: string
  models: Record<string, ModelsDevModelEntry>
}

interface ModelsDevDatabase extends Record<string, ModelsDevProviderEntry> {}

const SUPPORTED_NPM_MAP: Record<string, ProviderFormat> = {
  '@ai-sdk/openai': 'openai',
  '@ai-sdk/anthropic': 'anthropic',
  '@ai-sdk/google': 'google',
  '@ai-sdk/deepseek': 'deepseek',
}

function resolveApiMode(provider: Record<string, any>): ProviderFormat | null {
  const npm = typeof provider.npm === 'string' ? provider.npm : ''
  return SUPPORTED_NPM_MAP[npm] || null
}

function buildProvider(providerId: string, data: Record<string, any>, apiMode: ProviderFormat): ModelsDevProvider {
  return {
    id: providerId,
    name: typeof data.name === 'string' && data.name.length > 0 ? data.name : providerId,
    apiMode,
    baseUrl: typeof data.api === 'string' ? data.api : '',
  }
}

function createModel(model: Record<string, any>, providerId: string): ModelsDevModel | null {
  const rawId = typeof model.id === 'string' && model.id.length > 0 ? model.id : ''
  if (!rawId) {
    return null
  }

  const name = typeof model.name === 'string' && model.name.length > 0 ? model.name : rawId
  const limit = model.limit || {}
  const contextLength = typeof limit.context === 'number' ? limit.context : undefined
  const maxTokens = typeof limit.output === 'number' ? limit.output : undefined
  const toolCall = Boolean(model.tool_call)
  const reasoning = Boolean(model.reasoning)
  const modalities = model.modalities || {}
  const modalitiesInput = Array.isArray(modalities.input) ? modalities.input : []
  const vision = modalitiesInput.includes('image')

  return {
    id: rawId,
    name,
    providerId,
    model: rawId,
    contextLength,
    maxTokens,
    toolCall,
    reasoning,
    vision,
  }
}

const FETCH_TIMEOUT_MS = 5000

let cachedDatabase: ModelsDevDatabase | null = null
let fetchPromise: Promise<ModelsDevDatabase> | null = null

async function fetchModelsDevData(): Promise<ModelsDevDatabase> {
  if (cachedDatabase) {
    return cachedDatabase
  }
  if (fetchPromise) {
    return fetchPromise
  }

  fetchPromise = (async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(MODELS_DEV_URL, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`Models.dev request failed: ${response.status}`)
      }
      const data = await response.json()
      cachedDatabase = data
      return data
    }
    finally {
      clearTimeout(timeoutId)
      fetchPromise = null
    }
  })()

  return fetchPromise
}

export async function getModelsDevProviders() {
  const database = await fetchModelsDevData()
  const providers: ModelsDevProvider[] = []

  Object.entries(database).forEach(([providerId, provider]) => {
    if (!provider || typeof provider !== 'object') {
      return
    }
    const apiMode = resolveApiMode(provider as Record<string, any>)
    if (!apiMode) {
      return
    }
    providers.push(buildProvider(providerId, provider as Record<string, any>, apiMode))
  })

  return providers
}

export async function getModelsDevModelsByProviderId(providerId: string) {
  const database = await fetchModelsDevData()
  const models: ModelsDevModel[] = []

  const provider = database[providerId]
  if (!provider || typeof provider !== 'object') {
    return models
  }

  const modelList = provider.models
  if (modelList && typeof modelList === 'object') {
    Object.values(modelList).forEach((model) => {
      if (!model || typeof model !== 'object') {
        return
      }
      const item = createModel(model as Record<string, any>, providerId)
      if (item) {
        models.push(item)
      }
    })
  }

  return models
}
