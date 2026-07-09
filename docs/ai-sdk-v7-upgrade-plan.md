# AI SDK v7.0+ 升级计划

> 分支：`refactor/ai-sdk-v7-upgrade`（已基于 `origin/main` 创建）
> 当前版本：`ai@^6.0.x`，`@ai-sdk/{anthropic,deepseek,google,openai}@^2–3`
> 目标版本：`ai@^7.0.0` + 兼容的 provider 包
>
> 本文档包含两层目标：
> 1. **机械迁移**（阶段 0–6）：把现有实现改到能在 v7 下编译运行，保证行为等价。
> 2. **v7 重新设计 multi-provider（推荐，重点）**：利用 v7 新能力把 `multi-provider` 改成更简洁、类型安全、符合 v7 约定的实现，而不是只做改名。

---

## 一、v7 关键破坏性变更（已与官方迁移指南核对）

| 类别 | v6 | v7 | 影响本仓库 |
|---|---|---|---|
| 流式结果属性 | `result.fullStream` | `result.stream` | ✅ `multi-provider.ts` |
| 生命周期回调 | `onFinish` | `onEnd`（`onFinish` 仍作弃用别名） | ✅ `multi-provider.ts` |
| Usage Token 字段 | `usage.reasoningTokens` / `usage.cachedInputTokens` | `usage.outputTokenDetails.reasoningTokens` / `usage.inputTokenDetails.cacheReadTokens` | ✅ 源读取 |
| 图片消息部件 | `type:'image'` + `image`/`mimeType` | `type:'file'` + `data`/`mediaType:'image'` | ✅ 消息构造 |
| Google Provider | `createGoogleGenerativeAI` / `GoogleGenerativeAIProvider` | `createGoogle` / `GoogleProvider` | ✅ `multi-provider.ts` |
| 系统提示 | `messages` 里放 `{role:'system'}` | 默认**拒绝** system 消息，改用顶层 `instructions` | ✅ 消息构造/调用 |
| 运行时 | Node ≥ 18 | **Node ≥ 22**，仅 ESM | ✅ CI / 构建环境 |
| 顶层已弃用属性 | — | `totalUsage` / `reasoningText` / `reasoning` / `request` / `response` / `providerMetadata` 标记弃用（仍可用，建议改用 `result.finalStep` / `result.usage`） | ⚠️ 需清理 |
| 保留（无需改） | `streamText`/`generateText`/`tool`/`dynamicTool`/`jsonSchema`/`textStream`/`UIMessage`/`FileUIPart`/`ChatStatus`/`maxOutputTokens` | 均保留 | ✅ |

**明确移除的导出（本仓库未使用）**：`experimental_customProvider`、`experimental_generateImage`、`experimental_output`、`experimental_prepareStep`。本仓库未使用 `useChat` / `generateObject` / `convertToModelMessages` / `experimental_*` 遥测，故 `@ai-sdk/react`、`@ai-sdk/otel` 暂不引入（`customProvider` 已从 `experimental_` 毕业，直接来自 `ai`）。

---

## 二、v7 视角下 multi-provider 的更好实现方案（推荐）

> 目标：不只是 `fullStream→stream` 改名，而是用 v7 的 `customProvider`、`instructions`、`ModelMessage`/`TextStreamPart` 类型、单一 `result.usage` 把 `multi-provider` 重构得更简洁、类型安全、符合 v7 约定。
> 约束：**对外契约 `IAIProvider.streamModel` / `complete` 的签名与产出 `IAIStreamChunk` 必须保持不变**（被 `agentLoop`、`conversationTitleGenerator`、`compactionStrategy` 及多个测试 mock 依赖）。

### 2.1 现状痛点

1. `MultiProvider` 持有 4 种 provider 客户端类型，在 `constructor` 的 `switch` 与 `createModelClient` 的 `chat()` vs `()` 两处按 `format` 分支，返回类型是 `any`。
2. 系统提示被 hack 成一条 `{role:'system'}` 消息塞进 `messages`——这正是 **v7 默认拒绝**的写法。
3. `transformToAISdkMessages` 返回 `any[]`，部件手工拼装；图片仍用 pre-v7 的 `type:'image'`。
4. usage 从**三处**冗余读取：`onFinish` 回调 + `fullStream` finish 块的 `totalUsage` + `result.totalUsage`。
5. `createConversationTitle` 为读 `result.text` 而走 `streamText`，绕了一圈。

### 2.2 v7 提供的新能力（直接对应上述痛点）

- **`customProvider`（毕业）**：`import { customProvider } from 'ai'`，用 `fallbackProvider` 包裹真实 provider，对外暴露统一的 `provider.languageModel(id)`。配合各 provider 统一的 `.languageModel(id)`（OpenAI 额外有 `.chat(id)` 强制 Chat Completions），可消灭 `switch` 与 `any`。
- **`instructions` 选项**：系统提示走顶层 `instructions`，不再污染 `messages`；v7 默认拒绝 `messages` 里的 `role:'system'`（兼容旧历史记录才用 `allowSystemInMessages`）。
- **类型化消息/流部件**：`ModelMessage[]` 与 `TextStreamPart` 让消息构造与流消费摆脱 `any` 与 `as any` 断言。
- **单一 usage 来源**：`result.usage` 即为全量 usage（`PromiseLike`），取代三处冗余读取。
- **`reasoning` 选项 + 标准化 `reasoning-delta`**：v7 跨 provider 统一推理抽取，手动转发 `reasoning-delta` 更可靠。

### 2.3 重新设计方案（核心骨架）

```ts
import { customProvider, dynamicTool, generateText, jsonSchema, streamText } from 'ai'
import type { LanguageModel, LanguageModelUsage, ModelMessage, TextStreamPart, CoreTool } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { ProviderFormat } from './types'

// 1) 用工厂表消灭 switch + any（替代原 constructor 的 switch）
const PROVIDER_FACTORIES: Record<ProviderFormat, (o: { apiKey: string; baseURL: string }) => Provider> = {
  anthropic: createAnthropic,
  deepseek: createDeepSeek,
  google: createGoogle,
  openai: createOpenAI,
}

function resolveModel(format: ProviderFormat, provider: Provider, model: string): LanguageModel {
  // OpenAI 保持走 Chat Completions（而非 Responses API），其余走统一 languageModel
  return format === 'openai' && 'chat' in provider
    ? (provider as ReturnType<typeof createOpenAI>).chat(model)
    : provider.languageModel(model)
}
```

```ts
export class MultiProvider {
  private underlying: Provider
  private provider: Provider   // customProvider 包裹，统一对外接口

  constructor(options: { baseUrl: string; apiKey: string; format?: ProviderFormat; logger?: ILogger }) {
    this.underlying = PROVIDER_FACTORIES[options.format ?? 'openai']({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
    })
    // customProvider 作为统一门面；模型 id 动态，用 fallbackProvider 委派
    this.provider = customProvider({ fallbackProvider: this.underlying })
  }

  private createModelClient(model: string): LanguageModel {
    return resolveModel(this.format, this.underlying, model) // 返回类型 LanguageModel，无 any
  }
```

```ts
  // 2) 系统提示不再进 messages；图片改 file 部件；返回类型化为 ModelMessage[]
  private transformToAISdkMessages(messages: LoopMessage[]): ModelMessage[] {
    return messages.map((message) => {
      if (message.role === 'user') {
        const content = message.content.map((c) => {
          if (c.type === 'text') return { type: 'text' as const, text: c.text }
          if (c.type === 'image') return { type: 'file' as const, data: c.data, mediaType: c.mimeType }
          if (c.type === 'file') return { type: 'file' as const, data: c.data, mediaType: c.mimeType }
          return { type: 'file' as const, data: c.data, mediaType: c.mimeType }
        })
        return { role: 'user', content }
      }
      if (message.role === 'assistant') {
        const content = message.content.map((c) => {
          if (c.type === 'text') return { type: 'text' as const, text: c.text }
          if (c.type === 'tool-call') return { type: 'tool-call' as const, toolCallId: c.toolCallId, toolName: c.toolName, input: c.args }
          if (c.type === 'image') return { type: 'file' as const, data: c.data, mediaType: c.mimeType }
          return { type: 'file' as const, data: c.data, mediaType: c.mimeType }
        })
        return { role: 'assistant', content }
      }
      // role === 'tool'
      const content = message.content
        .filter((c) => c.type === 'tool-result')
        .map((c) => ({
          type: 'tool-result' as const,
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          output: { type: c.isError ? ('error-text' as const) : ('text' as const), value: String(c.result ?? '') },
        }))
      return { role: 'tool', content }
    })
  }
```

```ts
  // 3) instructions 替代 system 消息；遍历 result.stream（类型化 TextStreamPart）；usage 单一来源
  async* streamModel(options: {...}): AsyncGenerator<IAIStreamChunk> {
    const { messages, modelSettings, tools, abortSignal } = options
    const aiSdkMessages = this.transformToAISdkMessages(messages)

    const aiTools = tools?.length
      ? Object.fromEntries(tools.map((t) => [t.name, dynamicTool({
          description: t.description,
          inputSchema: jsonSchema(t.inputSchema),
          execute: async () => { throw new Error('RUNTIME_EXTERNAL_TOOL_EXECUTION') },
        })]))
      : undefined

    const result = streamText({
      model: this.createModelClient(modelSettings.model),
      instructions: modelSettings.systemPrompt,   // ← 关键：系统提示走这里
      messages: aiSdkMessages,
      temperature: modelSettings.temperature,
      maxOutputTokens: modelSettings.maxTokens,
      tools: aiTools,
      abortSignal,
    })

    let finalUsage: LanguageModelUsage | undefined
    let finishReason: string | undefined

    for await (const part of result.stream as AsyncIterable<TextStreamPart<Record<string, never>>>) {
      switch (part.type) {
        case 'reasoning-delta':
          yield { reasoningContent: part.text }; break
        case 'text-delta':
          yield { content: [{ type: 'text', text: part.text }] }; break
        case 'tool-call':
          yield { functionCalls: [{ id: part.toolCallId, toolName: part.toolName, args: part.input, executeState: 'await' as const }] }; break
        case 'finish':
          finalUsage = part.usage; finishReason = part.finishReason; break
        case 'error':
          throw this.normalizeError(part.error); break
        case 'abort':
          throw new AgentError('AGENT_CANCELLED', 'Task cancelled'); break
      }
    }

    const usage = finalUsage ?? await result.usage   // ← 单一来源
    yield { usage: this.normalizeUsage(usage), finishReason }
  }
```

```ts
  // 4) complete 同样用 instructions；createConversationTitle / validateConnection 改用 generateText 直接拿 text
  async complete(options: {...}) {
    const result = await generateText({
      model: this.createModelClient(options.modelSettings.model),
      instructions: options.modelSettings.systemPrompt,
      messages: this.transformToAISdkMessages(options.messages as LoopMessage[]),
      maxOutputTokens: options.modelSettings.maxTokens,
      abortSignal: options.abortSignal,
    })
    return { text: result.text, usage: this.normalizeUsage(result.usage) }
  }

  async createConversationTitle({ context, model }) {
    const { text } = await generateText({ model: this.createModelClient(model), prompt: context })
    return text
  }

  async validateConnection(model: string) {
    try {
      const { text } = await generateText({ model: this.createModelClient(model), prompt: 'Hi', maxOutputTokens: 1 })
      return text != null ? { success: true } : { success: false, error: 'Failed to get response' }
    } catch (e: any) { /* 现有友好错误处理 */ }
  }

  private normalizeUsage(usage?: LanguageModelUsage) {
    if (!usage) return undefined
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      reasoningTokens: usage.outputTokenDetails?.reasoningTokens,     // ← v7 嵌套字段
      cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,     // ← v7 嵌套字段
    }
  }
}
```

### 2.4 逐项说明（为什么更好）

| 现状 | v7 更好做法 | 收益 |
|---|---|---|
| `switch` 建 4 个客户端 + `any` 返回 | `PROVIDER_FACTORIES` 表 + `customProvider` 门面 + `.languageModel(id)` | 无 `any`、单点扩展新 provider、调用路径统一 |
| 系统提示塞进 `messages` | `instructions` 顶层选项 | 符合 v7 默认约定（否则运行时拒绝 system 消息）；消息构造更简单 |
| `transformToAISdkMessages` 返回 `any[]` | 返回 `ModelMessage[]`，图片用 `file`+`mediaType` | 编译期类型校验，避免拼错部件 |
| 遍历 `fullStream` + `chunk as any` | 遍历 `result.stream`（`TextStreamPart` 类型化） | 去掉 `as any`，part 字段有提示 |
| usage 三处冗余读取 | `await result.usage` 单一来源（finish 块兜底） | 少一个回调、少一处出错面 |
| `createConversationTitle` 用 `streamText` 读 `text` | `generateText` → `result.text` | 更直接，省一次流消费 |

### 2.5 评估过但暂不采纳的 v7 能力（写明原因）

- **`toUIMessageStream()` / `toUIMessageStreamResponse()`**：v7 的 UI 数据流序列化能力。本仓库的流协议是自定义的 IPC chunk（`reasoningContent` / `functionCalls` / `content` / `usage`），由 `agent-runtime` 边界消费，未采用 AI SDK 的 UI data-stream 协议。若未来重构 agent-runtime 边界，可用 `streamText(...).toUIMessageStream()` 替代手工序列化；当前超出 multi-provider 范围，**不在本次迁移内**。
- **v7 Agent（`createAgent` + `stopWhen: isStepCount(n)`）**：可把多步/工具循环内聚进 SDK。但本仓库工具在 SDK 之外由 MCP/agent-runtime 执行（`dynamicTool.execute` 直接抛 `RUNTIME_EXTERNAL_TOOL_EXECUTION`），移动工具执行进 SDK 是更大的架构变更。**不在本次范围内**，列为后续可探索方向。
- **`convertToModelMessages` / `UIMessage`**：需把内部消息存储改为 `UIMessage` 才能受益。内部消息有自定义 schema 且持久化在 DB，**改动面过大**，本次不采用；`transformToAISdkMessages` 手动映射更稳妥。
- **`customProvider` 门面（实际落地未采用）**：原计划用 `customProvider({ fallbackProvider })` 作统一门面。但本场景模型 id 动态、且 OpenAI 必须走 `.chat(id)` 强制 Chat Completions，门面无法被真正消费——`resolveModel` 仍需直接调用底层 provider 的 `.languageModel`/`.chat`，`fallbackProvider` 对非 openai 也只是等价转发。引入它只是无收益的抽象，故实际落地改用 `PROVIDER_FACTORIES` 表 + `resolveModel` 函数消灭 switch 与 any，达到同样目标而不增加复杂度与不确定性。

### 2.6 重新设计的风险与注意

- **`customProvider` 的 `languageModels` 是静态 `Record`**：模型 id 动态，故用 `fallbackProvider` 委派（上面方案），而非预先注册。确认 `fallbackProvider.languageModel(id)` 对 four 厂商都可用（OpenAI 的 fallback 会走 `languageModel` 而非 `chat`——若必须强制 Chat Completions，则在 `resolveModel` 里对 openai 显式 `chat(id)`，不要依赖 fallback）。
- **`tool-call` 流部件的 `input` 字段名**：v7 `TextStreamPart` 的 `tool-call` 仍带 `toolCallId`/`toolName`/`input`（与 v6 一致），但上线前用 `result.stream` 的类型确认 `part.input` 字段名。
- **`stream` 的 `finish` 部件字段**：v7 用 `usage`（非 `totalUsage`）+ `finishReason`，与上面 `case 'finish'` 一致；保留 `finalUsage ?? await result.usage` 兜底以防 finish 块缺字段。
- **`reasoning-delta` 跨 provider**：v7 标准化后更可靠，但个别厂商（如 DeepSeek 推理模型）输出格式差异仍可能存在，需冒烟测试覆盖。

---

## 三、核心决策（决定改动面大小）

**决策 1：保留内部 usage schema 字段名不变，只改 AI SDK 源读取。**
仓库内部有两套 `LanguageModelUsage`：
- **AI SDK** 的 `LanguageModelUsage`（v7 移除了 `reasoningTokens`/`cachedInputTokens` 顶层字段）。
- **`@ant-chat/shared`** 自有的 `LanguageModelUsageSchema`（`packages/shared/src/schemas/messages.ts:159`），顶层保留 `reasoningTokens`/`cachedInputTokens`，是 `IMessage.usage` / `IAIStreamChunk.usage` 的真实类型。

策略：`MultiProvider.normalizeUsage()` **只改“从 AI SDK usage 取值”的源读取**（v7 嵌套结构），输出仍按内部字段名返回。所有消费内部 usage 的地方字段名不动，仅把原先“误从 `ai` 导入”的 `LanguageModelUsage` 类型改为从 `@ant-chat/shared` 导入，以消除 v7 类型编译错误。

**决策 2：provider 包升级到与 `ai@7` 兼容的版本**，由 pnpm 解析 peer 依赖；升级后用 codemod + 人工核对 Google 重命名（若采用 2.3 的工厂表，`createGoogleGenerativeAI→createGoogle` 已在工厂表里直接写好）。

**决策 3：Node 版本已在 CI 满足（ci.yml 用 node 22），本地无 `engines` 字段，建议补充。**

**决策 4：multi-provider 采用第二节的 v7 重新设计（推荐）**，而非仅机械改名。阶段 2 直接落地 2.3 方案。

---

## 四、分步执行计划

### 阶段 0：依赖升级（package.json）
1. `packages/backend/package.json`：`ai`→`^7.0.0`；`@ai-sdk/anthropic`/`deepseek`/`google`/`openai` 升到与 `ai@7` 兼容版本（安装时取最新，校验 peer）。
2. `packages/ui/package.json`：`ai`→`^7.0.0`。
3. `apps/web/package.json`：`ai`→`^7.0.0`。
4. `pnpm install`（解析 peer 依赖到与 `ai@7` 匹配的 provider 版本）。

### 阶段 1：先跑官方 Codemod（自动批处理）
```
npx @ai-sdk/codemod v7
```
覆盖：`rename-full-stream-to-stream`、`rename-on-finish-to-on-end`、`replace-cached-input-tokens`、`replace-reasoning-tokens`、`replace-image-message-part-with-file`、`rename-google-generative-ai-to-google` 等。
> `multi-provider.ts` 是高度定制的手写逻辑，codemod 无法完全覆盖；阶段 2 直接按 2.3 重写，可不依赖 codemod 结果。

### 阶段 2：重写 `multi-provider.ts`（落地第二节 v7 重新设计）
按 2.3 骨架实现：
- `PROVIDER_FACTORIES` 表取代 `constructor` 的 `switch`；`customProvider` 门面；`resolveModel` 统一 `.languageModel(id)`（OpenAI 走 `.chat(id)`）。
- `transformToAISdkMessages`：去掉 system 消息构造，返回 `ModelMessage[]`；图片统一 `file`+`mediaType`。
- `streamModel`：`instructions` 替代 system；遍历 `result.stream`（`TextStreamPart` 类型化）；`finish` 块 + `await result.usage` 单一来源。
- `complete`：`instructions` + `generateText`。
- `createConversationTitle` / `validateConnection`：改用 `generateText` 直接取 `result.text`。
- `normalizeUsage`：源读取改 `outputTokenDetails.reasoningTokens` / `inputTokenDetails.cacheReadTokens`。
- 对外 `streamModel` / `complete` 签名与 `IAIStreamChunk` 产出**保持不变**（满足契约）。

### 阶段 3：内部 usage 类型导入修正（字段名不变，只改来源）
- `packages/ui/src/components/context-usage.tsx`：L3 `LanguageModelUsage` 从 `ai` 改为从 `@ant-chat/shared` 导入（实际传的是内部归一化对象）；L205/241/259 字段读取不变。
- `apps/web/src/components/Sender/sessionUsage.ts`：L2/L4 改为内部 `LanguageModelUsage`；L16–17 读 `message.usage.*`（内部）不变；删除 L31–39 的 `inputTokenDetails`/`outputTokenDetails` 块（内部 schema 无此字段、无消费方）。
- `apps/web/src/components/Sender/Sender.tsx`：L2 `FileUIPart` 保留；`LanguageModelUsage` 若标注内部 usage 值则改从 `@ant-chat/shared` 导入（确认实际用法）。

### 阶段 4：UI ai-elements（仅核对编译）
`message.tsx`(`UIMessage`)、`prompt-input.tsx`(`ChatStatus`/`FileUIPart`/`SourceDocumentUIPart`)、`attachments.tsx`(`FileUIPart`/`SourceDocumentUIPart`) 在 v7 均保留，跑 `pnpm type-check` 确认。

### 阶段 5：测试与运行时
- `packages/backend/.../multi-provider.spec.ts`：mock 的 `fullStream`→`stream`；`totalUsage`→`usage`，内部结构改 v7（`outputTokenDetails:{reasoningTokens:20}`、`inputTokenDetails:{cacheReadTokens:100}`）。
- `apps/web/.../sessionUsage.spec.ts`：内部 schema 形状不变，确认即可（无需改）。
- 因 `streamModel`/`complete` 契约不变，依赖它们的 `agentLoop.spec`、`AgentRuntime.spec`、`agentFullChainPermissions.spec` 等 mock 应无需改动（仅 mock 实现细节若引用了旧字段需同步）。

### 阶段 6：环境与 CI
- `.github/workflows/ci.yml` 已用 `node-version: 22` ✅。
- 建议（可选）在 root / 各 `package.json` 增加 `"engines": { "node": ">=22" }`。
- 确认整仓 ESM（`apps/desktop` 主进程若含 CommonJS 需改造；当前未发现 `from 'ai'` 出现在 desktop，风险低）。

---

## 五、验证清单（执行后必须跑）

```bash
pnpm install          # 解析 ai@7 与 provider 兼容版本
pnpm type-check      # tsc -b：重点 shared / backend / ui / web 的 usage 类型与 multi-provider 重写
pnpm lint            # eslint .
pnpm test:unit      # 重点 multi-provider.spec、sessionUsage.spec、agentLoop.spec
```

**手动冒烟测试**：
1. 带推理模型（deepseek-r1 / claude 思考模式）发对话，确认 `stream` 正确产出 `reasoning-delta` → `text-delta` → `tool-call`（若触发工具）链路。
2. 工具调用走外部 MCP 执行（`dynamicTool.execute` 抛 `RUNTIME_EXTERNAL_TOOL_EXECUTION`）链路正常。
3. 会话用量面板（`ContextUsage`）正确显示 reasoning / cache 命中 token（验证 `outputTokenDetails`/`inputTokenDetails` 映射）。
4. `createConversationTitle` / `validateConnection` 在新实现下行为与旧版一致。

---

## 六、风险与开放问题

- **provider 包精确目标版本**：以 `pnpm install` 解析结果为准；安装后 `pnpm why ai` 确认无多版本冲突。
- **`Sender.tsx` 中 `LanguageModelUsage` 的实际用途**：需在该文件确认是否标注内部 usage，再决定改导入来源（见阶段 3）。
- **`tool-call` 部件 `input` 字段名 / `finish` 部件字段**：上线前用 `result.stream` 类型确认（见 2.6）。
- **`result.totalUsage` / `result.reasoningText` 弃用**：阶段 2 已不依赖，长期可清理。
- **`customProvider` fallback 对 OpenAI 的 Chat Completions 强制**：务必在 `resolveModel` 显式 `.chat(id)`（见 2.6）。

---

## 七、建议提交粒度

1. `chore(deps)`: 升级 `ai` 与 provider 包版本。
2. `refactor(ai)`: **重写** `multi-provider.ts` 到 v7 实现（`customProvider` + `instructions` + 类型化 `ModelMessage`/`TextStreamPart` + 单一 `result.usage`）。
3. `refactor(usage)`: 内部 `LanguageModelUsage` 类型导入来源修正（ui/web）。
4. `test`: 同步更新 `multi-provider.spec.ts` 模拟对象。
（每步附带 changeset：`pnpm changeset`）
