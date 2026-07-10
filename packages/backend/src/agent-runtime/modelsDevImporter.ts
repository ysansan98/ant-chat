import type { ReasoningEffortLevel } from '@ant-chat/shared'
import type { AppDataContext } from '../data'
import { getModelsDevModelsByProviderId, getModelsDevProviders } from './modelsDev'

export interface ImportModelsDevModelsResult {
  added: string[]
  skipped: string[]
  duplicates: string[]
  errors: { model: string, reason: string }[]
}

export interface ModelsDevImporter {
  getModelsDevProviders: () => ReturnType<typeof getModelsDevProviders>
  getModelsDevModelsByProviderId: (providerId: string) => ReturnType<typeof getModelsDevModelsByProviderId>
  importModelsDevModels: (providerId: string) => Promise<ImportModelsDevModelsResult>
}

export function createModelsDevImporter(appDataContext: AppDataContext): ModelsDevImporter {
  return {
    getModelsDevProviders,
    getModelsDevModelsByProviderId,

    async importModelsDevModels(providerId: string): Promise<ImportModelsDevModelsResult> {
      const models = await getModelsDevModelsByProviderId(providerId)
      const provider = appDataContext.providerSettingsRepository.getProviderSettingsById(providerId)
      const existingModelSet = new Set(provider ? Object.keys(provider.models) : [])
      const added: string[] = []
      const skipped: string[] = []
      const duplicates: string[] = []
      const errors: { model: string, reason: string }[] = []
      const seen = new Set(existingModelSet)

      for (const model of models) {
        const displayName = model.name ? `${model.name} (${model.model})` : model.model
        if (seen.has(model.model)) {
          if (existingModelSet.has(model.model)) {
            skipped.push(displayName)
          }
          else {
            duplicates.push(displayName)
          }
          continue
        }

        try {
          appDataContext.providerSettingsRepository.createProviderModel({
            providerId,
            model: model.model,
            name: model.name,
            temperature: 0.7,
            maxTokens: model.maxTokens ?? 4096,
            contextLength: model.contextLength ?? 4096,
            capabilities: toModelCapabilities(model),
            cost: model.cost,
          })
          seen.add(model.model)
          added.push(displayName)
        }
        catch (error) {
          errors.push({ model: displayName, reason: (error as Error).message })
        }
      }

      return { added, skipped, duplicates, errors }
    },
  }
}

function toModelCapabilities(model: { toolCall?: boolean, reasoning?: boolean, reasoningLevels?: ReasoningEffortLevel[], supportsTemperature?: boolean, structuredOutput?: boolean, modalities?: { input?: string[], output?: string[] } }) {
  return {
    functionCall: model.toolCall ?? false,
    reasoning: model.reasoning ?? false,
    reasoningLevels: model.reasoningLevels,
    supportsTemperature: model.supportsTemperature ?? false,
    structuredOutput: model.structuredOutput ?? false,
    inputModalities: (model.modalities?.input ?? []) as ('text' | 'image' | 'pdf' | 'video' | 'audio')[],
    outputModalities: (model.modalities?.output ?? []) as ('text' | 'image')[],
  }
}
