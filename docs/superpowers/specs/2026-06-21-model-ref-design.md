# Model 引用重构：从扁平 modelId 到 (providerId, modelId) 分字段

## 背景

当前系统使用扁平字符串 `modelId` 作为 Conversation 和 AppSettings 中模型的引用标识。由于历史迁移和 models.dev 导入，同一 `modelId` 可能出现在多个 provider 中（如 `deepseek-v4-flash` 同时存在于 deepseek 和 opencode-go），导致 `getModelById()` 线性扫描返回错误 provider。

## 问题分析

`getModelById()` 遍历所有 provider 的 `models` 字典，返回第一个匹配。当跨 provider 存在同名 modelId 时，查找结果不确定。所有调用方在拿到 model 后立即 `getProviderById()`，说明**没有任何调用方只需 model 而不需 provider**。

## 设计变更

### 核心概念

Model 在业务域中不独立存在，它永远属于一个 Provider。存储和传输时应始终携带 `(providerId, modelId)` 对，而非扁平字符串。

### 类型定义

```typescript
// 引用类型（存储/传输）
interface ModelRef {
  providerId: string
  modelId: string
}

// 解析结果（一次查询出 model + provider）
interface ResolvedModel {
  model: AgentModel
  provider: ProviderConfig
}
```

### IModelCatalog 接口重设计

```typescript
interface IModelCatalog {
  // ① 一次性解析 model + provider（用于 runtime 启动）
  resolveModel(ref: ModelRef): Promise<ResolvedModel | null>

  // ② 纯查询（用于 UI 展示，调用方已知 providerId）
  getModel(providerId: string, modelId: string): Promise<AgentModel | null>
  getProvider(providerId: string): Promise<ProviderConfig | null>
}
```

删除：`getModelById()`、`getProviderByModelId()`（不再需要）

### 存储层 Schema 变更

```typescript
// ConversationsSettingsSchema
{
  modelId: string,     // 保持，"deepseek-v4-flash"
  providerId: string,  // 新增，"deepseek"
}

// AppSettingsSchema
{
  assistantModelId: string,      // "deepseek-v4-flash"
  assistantProviderId: string,   // "deepseek"
}
```

### ProviderSettingsRepository 变更

```typescript
// 新增
getModel(providerId: string, modelId: string): ProviderConfigModelSchema | null {
  const provider = this.store.read().providers.find(p => p.id === providerId)
  const model = provider?.models[modelId]
  return model ? toProviderConfigModel(providerId, modelId, model) : null
}

resolveModel(providerId: string, modelId: string): { model: ProviderConfigModelSchema, provider: ProviderConfigSchema } | null {
  const provider = this.store.read().providers.find(p => p.id === providerId)
  if (!provider) return null
  const model = provider.models[modelId]
  if (!model) return null
  return {
    model: toProviderConfigModel(providerId, modelId, model),
    provider: toProviderConfig(provider),
  }
}

// 删除
getModelById()       // 被 getModel() + resolveModel() 替代
getProviderByModelId() // 不再需要
```

### Runtime 链路变化

```
Before:
  agentTurnService:
    model = catalog.getModelById(modelId)     // 有歧义
    provider = catalog.getProviderById(model.providerId)
    aiProvider = createProvider(provider)
    runtime.startTask({ modelId, aiProvider })  // 传 raw string
    └─ SessionRuntime:
         model = catalog.getModelById(modelId) // 重复查找
         provider = catalog.getProviderById(model.providerId)
         aiProvider = options.aiProvider ?? createProvider(provider) // 条件创建

After:
  agentTurnService:
    resolved = catalog.resolveModel({ providerId, modelId })
    aiProvider = createProvider(resolved.provider)
    runtime.startTask({
      model: resolved.model,        // 已解析
      provider: resolved.provider,  // 已解析
      aiProvider,                   // 已创建
    })
    └─ SessionRuntime:
         // 直接用 options.model + options.provider + options.aiProvider
         // 不再调用 modelCatalog
```

### AgentRuntimeStartTaskOptions 变更

```typescript
interface AgentRuntimeStartTaskOptions {
  // 删除
  modelId: string

  // 新增
  model: AgentModel
  provider: ProviderConfig
  aiProvider?: IAIProvider  // 保留
  // ...
}
```

### 前端变更

Conversation settings 存储和传输改为分字段：

```typescript
// useConversationSettings / chatSettings context
{
  modelId: string,
  providerId: string,
  systemPrompt: string,
  temperature: number,
  maxTokens: number,
}

// 选模型 onChange 时传
onChange?.({ ...model, providerId: activeProvider.id })
```

PickerModel / SelectModel 比对逻辑：

```typescript
// 选中判定
const [activeProviderId, activeModelId] = [settings.providerId, settings.modelId]
const activeProvider = data?.find(item => item.id === activeProviderId)
const currentModelInfo = activeProvider?.models.find(model => model.id === activeModelId)
```

### GeneralSettings 变更

```typescript
interface GeneralSettingsState {
  assistantModelId: string
  assistantProviderId: string
  proxySettings: ProxySettings
}
```

## 受影响的文件清单

### Schema / Interface 层（6 文件）

| 文件 | 变更 |
|---|---|
| `packages/shared/src/schemas/conversations.ts` | ConversationsSettingsSchema 新增 `providerId` |
| `packages/shared/src/schemas/appSettings.ts` | AppSettingsSchema 新增 `assistantProviderId` |
| `packages/shared/src/interfaces/generalSettings.ts` | GeneralSettingsSchema 映射新增 |
| `packages/shared/src/interfaces/agent-runtime-electron.ts` | StartAgentTurnOptions 新增 `providerId` |
| `packages/shared/src/interfaces/agent-runtime-interfaces.ts` | IModelCatalog 重设计；AgentRuntimeStartTaskOptions 替换为 model+provider |
| `packages/shared/src/interfaces/app-rpc.ts` | RPC 方法名更新 |

### 后端核心层（6 文件）

| 文件 | 变更 |
|---|---|
| `packages/app-data/src/settings/providerSettingsRepository.ts` | 新增 `getModel()`、`resolveModel()`；删除 `getModelById()`、`getProviderByModelId()` |
| `packages/app-data/src/settings/modelCatalog.ts` | 适配新接口 |
| `packages/agent-runtime/src/agentTurnService.ts` | 用 resolveModel，传 `model+provider` 给 runtime |
| `packages/agent-core/src/session/SessionRuntime.ts` | 直接用 `options.model/provider`，移除 modelCatalog 调用 |
| `packages/agent-runtime/src/conversationTitleGenerator.ts` | 接收 `ResolvedModel` 或 resolveModel |
| `packages/agent-runtime/src/compactCommand.ts` | 改用 resolveModel |

### AppRuntime 层（2 文件）

| 文件 | 变更 |
|---|---|
| `packages/app-runtime/src/appRuntime.ts` | RPC handlers 更新 |
| `packages/app-runtime/src/rpcHandlers.ts` | 方法名/参数更新 |

### 前端核心层（10 文件）

| 文件 | 变更 |
|---|---|
| `apps/web/src/components/Sender/PickerModel.tsx` | 比对/传参基于 `providerId+modelId` |
| `apps/web/src/components/Sender/SelectModel.tsx` | value 改为按 provider 分组比对 |
| `apps/web/src/components/Sender/Sender.tsx` | `settings.providerId` 传参 |
| `apps/web/src/components/Sender/ModelParameterSettingsPanel.tsx` | 传 `{providerId, modelId}` 查询 model 元数据 |
| `apps/web/src/components/Chat/Chat.tsx` | `modelConfig` 传 `providerId` |
| `apps/web/src/components/GeneralSettings/SelectModel.tsx` | `assistantProviderId` 传参 |
| `apps/web/src/contexts/chatSettings/context.ts` | DEFAULT_SETTINGS 新增 `providerId` |
| `apps/web/src/hooks/useConversationSettings.ts` | 读写 `providerId` |
| `apps/web/src/store/generalSettings/store.ts` | `assistantProviderId` |
| `apps/web/src/store/generalSettings/actions.ts` | `assistantProviderId` |
| `apps/web/src/store/conversation/actions.ts` | `providerId` 传参 |
| `apps/web/src/api/chatApi.ts` | `providerId` + `modelId` 传参 |
| `apps/web/src/api/providerApi.ts` | `getModel` 和 `getProviderByModelId` 更新 |

### 测试文件（~16 文件）

Mocks 和入参同步更新。

## 注意事项

1. **无后向兼容**：历史数据中的纯 `modelId`（不含 provider 上下文）将无法解析，用户需要重新选择模型
2. **ModelInfo（消息记录）**：`ModelInfoSchema` 已有 `providerId` 字段，无需变更
3. **`setModelEnabledStatus` / `deleteProviderModel`**：这些方法通过 modelId（provider 内唯一 key）操作，调用方已知 provider 上下文，无需变更
4. **前端 RPC `getModelById` → `getModel`**：参数从 `{ id: string }` 变为 `{ providerId: string, modelId: string }`
