import { getModelsDevModelsByProviderId, getModelsDevProviders } from './modelsDev'

export interface ModelsDevImporter {
  getModelsDevProviders: () => ReturnType<typeof getModelsDevProviders>
  getModelsDevModelsByProviderId: (providerId: string) => ReturnType<typeof getModelsDevModelsByProviderId>
}

export function createModelsDevImporter(): ModelsDevImporter {
  return {
    getModelsDevProviders,
    getModelsDevModelsByProviderId,
  }
}
