import { db } from './db'
import { serviceProviderModelsTable, serviceProviderTable } from './schema'

const providerServiceData = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', apiMode: 'openai' as const, isOfficial: true },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiMode: 'openai' as const, isOfficial: true },
  { id: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiMode: 'gemini' as const, isOfficial: true },
]

const providerServiceModelsData = [
  // ============================ Gemini 内置模型 ============================
  { id: 'gemini-embedding-001', name: 'Gemini Embedding 001', model: 'gemini-embedding-001', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 2048, maxTokens: 3072, modelFeatures: { vision: false, functionCall: false, reasoning: false } },
  { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', model: 'gemini-2.5-flash-image', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 32768, maxTokens: 32768, modelFeatures: { vision: true, functionCall: false, reasoning: true } },
  { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash Preview 05-20', model: 'gemini-2.5-flash-preview-05-20', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-flash-lite-latest', name: 'Gemini Flash-Lite Latest', model: 'gemini-flash-lite-latest', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', model: 'gemini-3-pro-preview', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1000000, maxTokens: 64000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-flash-latest', name: 'Gemini Flash Latest', model: 'gemini-flash-latest', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro Preview 05-06', model: 'gemini-2.5-pro-preview-05-06', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', model: 'gemini-2.0-flash-lite', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 8192, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'gemini-live-2.5-flash-preview-native-audio', name: 'Gemini Live 2.5 Flash Preview Native Audio', model: 'gemini-live-2.5-flash-preview-native-audio', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 131072, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', model: 'gemini-2.0-flash', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 8192, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', model: 'gemini-2.5-flash-lite', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-2.5-pro-preview-06-05', name: 'Gemini 2.5 Pro Preview 06-05', model: 'gemini-2.5-pro-preview-06-05', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-live-2.5-flash', name: 'Gemini Live 2.5 Flash', model: 'gemini-live-2.5-flash', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 128000, maxTokens: 8000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-2.5-flash-lite-preview-06-17', name: 'Gemini 2.5 Flash Lite Preview 06-17', model: 'gemini-2.5-flash-lite-preview-06-17', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-2.5-flash-image-preview', name: 'Gemini 2.5 Flash Image (Preview)', model: 'gemini-2.5-flash-image-preview', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 32768, maxTokens: 32768, modelFeatures: { vision: true, functionCall: false, reasoning: true } },
  { id: 'gemini-2.5-flash-preview-09-2025', name: 'Gemini 2.5 Flash Preview 09-25', model: 'gemini-2.5-flash-preview-09-2025', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-2.5-flash-preview-04-17', name: 'Gemini 2.5 Flash Preview 04-17', model: 'gemini-2.5-flash-preview-04-17', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', model: 'gemini-2.5-pro', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', model: 'gemini-1.5-flash', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1000000, maxTokens: 8192, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'gemini-1.5-flash-8b', name: 'Gemini 1.5 Flash-8B', model: 'gemini-1.5-flash-8b', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1000000, maxTokens: 8192, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'gemini-2.5-flash-lite-preview-09-2025', name: 'Gemini 2.5 Flash Lite Preview 09-25', model: 'gemini-2.5-flash-lite-preview-09-2025', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1048576, maxTokens: 65536, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', model: 'gemini-1.5-pro', isBuiltin: true, isEnabled: true, serviceProviderId: 'gemini', apiMode: 'gemini', temperature: 0.7, contextLength: 1000000, maxTokens: 8192, modelFeatures: { vision: true, functionCall: true, reasoning: false } },

  // ============================ openai 内置模型 ============================
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 nano', model: 'gpt-4.1-nano', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 1047576, maxTokens: 32768, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'text-embedding-3-small', name: 'text-embedding-3-small', model: 'text-embedding-3-small', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 8191, maxTokens: 1536, modelFeatures: { vision: false, functionCall: false, reasoning: false } },
  { id: 'gpt-4', name: 'GPT-4', model: 'gpt-4', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 8192, maxTokens: 8192, modelFeatures: { vision: false, functionCall: true, reasoning: false } },
  { id: 'o1-pro', name: 'o1-pro', model: 'o1-pro', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 200000, maxTokens: 100000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gpt-4o-2024-05-13', name: 'GPT-4o (2024-05-13)', model: 'gpt-4o-2024-05-13', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 128000, maxTokens: 4096, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'gpt-5.1-codex', name: 'GPT-5.1 Codex', model: 'gpt-5.1-codex', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 400000, maxTokens: 128000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gpt-4o-2024-08-06', name: 'GPT-4o (2024-08-06)', model: 'gpt-4o-2024-08-06', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 128000, maxTokens: 16384, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', model: 'gpt-4.1-mini', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 1047576, maxTokens: 32768, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'o3-deep-research', name: 'o3-deep-research', model: 'o3-deep-research', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 200000, maxTokens: 100000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5-turbo', model: 'gpt-3.5-turbo', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 16385, maxTokens: 4096, modelFeatures: { vision: false, functionCall: false, reasoning: false } },
  { id: 'text-embedding-3-large', name: 'text-embedding-3-large', model: 'text-embedding-3-large', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 8191, maxTokens: 3072, modelFeatures: { vision: false, functionCall: false, reasoning: false } },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', model: 'gpt-4-turbo', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 128000, maxTokens: 4096, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'o1-preview', name: 'o1-preview', model: 'o1-preview', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 128000, maxTokens: 32768, modelFeatures: { vision: false, functionCall: false, reasoning: true } },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex mini', model: 'gpt-5.1-codex-mini', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 400000, maxTokens: 128000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'o3-mini', name: 'o3-mini', model: 'o3-mini', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 200000, maxTokens: 100000, modelFeatures: { vision: false, functionCall: true, reasoning: true } },
  { id: 'gpt-5.1', name: 'GPT-5.1', model: 'gpt-5.1', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 400000, maxTokens: 128000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'codex-mini-latest', name: 'Codex Mini', model: 'codex-mini-latest', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 200000, maxTokens: 100000, modelFeatures: { vision: false, functionCall: true, reasoning: true } },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', model: 'gpt-5-nano', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 400000, maxTokens: 128000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gpt-5-codex', name: 'GPT-5-Codex', model: 'gpt-5-codex', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 400000, maxTokens: 128000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gpt-4o', name: 'GPT-4o', model: 'gpt-4o', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 128000, maxTokens: 16384, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'gpt-4.1', name: 'GPT-4.1', model: 'gpt-4.1', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 1047576, maxTokens: 32768, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'o4-mini', name: 'o4-mini', model: 'o4-mini', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 200000, maxTokens: 100000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'o1', name: 'o1', model: 'o1', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 200000, maxTokens: 100000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', model: 'gpt-5-mini', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 400000, maxTokens: 128000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'o1-mini', name: 'o1-mini', model: 'o1-mini', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 128000, maxTokens: 65536, modelFeatures: { vision: false, functionCall: false, reasoning: true } },
  { id: 'text-embedding-ada-002', name: 'text-embedding-ada-002', model: 'text-embedding-ada-002', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 8192, maxTokens: 1536, modelFeatures: { vision: false, functionCall: false, reasoning: false } },
  { id: 'o3-pro', name: 'o3-pro', model: 'o3-pro', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 200000, maxTokens: 100000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gpt-4o-2024-11-20', name: 'GPT-4o (2024-11-20)', model: 'gpt-4o-2024-11-20', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 128000, maxTokens: 16384, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', model: 'gpt-5.1-codex-max', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 400000, maxTokens: 128000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'o3', name: 'o3', model: 'o3', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 200000, maxTokens: 100000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'o4-mini-deep-research', name: 'o4-mini-deep-research', model: 'o4-mini-deep-research', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 200000, maxTokens: 100000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gpt-5-chat-latest', name: 'GPT-5 Chat (latest)', model: 'gpt-5-chat-latest', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 400000, maxTokens: 128000, modelFeatures: { vision: true, functionCall: false, reasoning: true } },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', model: 'gpt-4o-mini', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 128000, maxTokens: 16384, modelFeatures: { vision: true, functionCall: true, reasoning: false } },
  { id: 'gpt-5', name: 'GPT-5', model: 'gpt-5', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 400000, maxTokens: 128000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gpt-5-pro', name: 'GPT-5 Pro', model: 'gpt-5-pro', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 400000, maxTokens: 272000, modelFeatures: { vision: true, functionCall: true, reasoning: true } },
  { id: 'gpt-5.1-chat-latest', name: 'GPT-5.1 Chat', model: 'gpt-5.1-chat-latest', isBuiltin: true, isEnabled: true, serviceProviderId: 'openai', apiMode: 'openai', temperature: 0.7, contextLength: 128000, maxTokens: 16384, modelFeatures: { vision: true, functionCall: true, reasoning: true } },

  // ============================ DeepSeek 内置模型 ============================
  { id: 'deepseek-chat', name: 'deepseek-chat', model: 'deepseek-chat', isBuiltin: true, isEnabled: true, maxTokens: 8000, temperature: 0.7, contextLength: 64000, modelFeatures: { functionCall: true, reasoning: false, vision: false }, apiMode: 'openai', serviceProviderId: 'deepseek' },
  { id: 'deepseek-reasoner', name: 'deepseek-reasoner', model: 'deepseek-reasoner', isBuiltin: true, isEnabled: true, maxTokens: 8000, temperature: 0.7, contextLength: 64000, modelFeatures: { functionCall: false, reasoning: true, vision: false }, apiMode: 'openai', serviceProviderId: 'deepseek' },
]

export async function initializeData() {
  db.transaction((tx) => {
    providerServiceData.forEach((row) => {
      tx.insert(serviceProviderTable).values(row).onConflictDoNothing({ target: serviceProviderTable.id }).run()
    })

    providerServiceModelsData.forEach((row) => {
      tx.insert(serviceProviderModelsTable)
        .values({ ...row })
        .onConflictDoUpdate({
          target: [serviceProviderModelsTable.model, serviceProviderModelsTable.serviceProviderId],
          set: {
            id: row.id,
            name: row.name,
            modelFeatures: row.modelFeatures,
            isBuiltin: row.isBuiltin,
            isEnabled: row.isEnabled,
            maxTokens: row.maxTokens,
            temperature: row.temperature,
            contextLength: row.contextLength,
            serviceProviderId: row.serviceProviderId,
          },
        })
        .run()
    })
  })
}
