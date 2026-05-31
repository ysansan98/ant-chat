import type { ProviderFormat } from '../schemas/providerConfig'

export interface ModelsDevProvider {
  id: string
  name: string
  apiMode: ProviderFormat
  baseUrl: string
}

export interface ModelsDevModelCost {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export interface ModelsDevModel {
  id: string
  name: string
  providerId: string
  model: string
  contextLength?: number
  maxTokens?: number
  toolCall?: boolean
  reasoning?: boolean
  supportsTemperature?: boolean
  structuredOutput?: boolean
  modalities?: {
    input?: string[]
    output?: string[]
  }
  cost?: ModelsDevModelCost
}

export interface ModelsDevImportResult {
  added: string[]
  skipped: string[]
  duplicates: string[]
  errors: { model: string, reason: string }[]
}
