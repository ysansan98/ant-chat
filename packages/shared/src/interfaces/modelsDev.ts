import type { ProviderFormat } from '../schemas/serviceProvider'

export interface ModelsDevProvider {
  id: string
  name: string
  apiMode: ProviderFormat
  baseUrl: string
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
  vision?: boolean
}

export interface ModelsDevImportResult {
  added: string[]
  skipped: string[]
  duplicates: string[]
  errors: { model: string, reason: string }[]
}
