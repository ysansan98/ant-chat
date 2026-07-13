# Plan 001: 收口 Sender 到 agent loop 的 turn 输入与会话配置

> **Executor instructions**: 这是给低上下文执行模型的完整实施计划。按步骤执行，每一步都运行验证命令并确认预期结果，再进入下一步。不要一次性机械替换全部字段。遇到 “STOP conditions” 中任一情况时停止并报告，不要自行扩展设计。完成后更新 `plans/README.md` 中本计划状态；除非调度者明确表示由其维护索引。
>
> **Drift check（第一条命令）**:
>
> ```bash
> git diff --stat 3c8c18ac..HEAD -- apps/web/src/components/Sender apps/web/src/components/Chat apps/web/src/contexts/chatSettings apps/web/src/hooks apps/web/src/store/chatSettings apps/web/src/store/pendingMessages apps/web/src/pages/Settings/MCPManage packages/shared/src packages/backend/src/agent-runtime packages/backend/src/agent-core packages/backend/src/data/sqlite packages/backend/src/automations
> ```
>
> 如果任一 scope 文件在计划生成后发生变化，先逐段对照 “Current state”。关键类型或调用链不一致时按 STOP condition 处理。

## Status

- **Priority**: P1
- **Effort**: L（建议拆成 5–7 个逻辑提交）
- **Risk**: HIGH（涉及 SQLite 数据迁移、共享 DTO、Web UI、runtime 与自动化调用方）
- **Depends on**: none
- **Category**: tech-debt / migration / correctness
- **Planned at**: commit `3c8c18ac`, 2026-07-13

## Why this matters

当前从 `Sender` 到 agent loop 的同一条用户输入同时以 `prompt`、`content[0].text`、`referencedFiles` 和 `selectedSkill` 多种形式传输，且 conversation settings 被整体展开为 `modelConfig`。这造成消息、标题、持久化历史和模型实际输入可以分叉，也让无效的 `features.enableMCP` 混进模型参数。

本计划完成后：

1. `messageContent` 是用户消息唯一业务真源，后端统一提取文本。
2. `@workspace/path` 本身表达工作区引用，不再传 `referencedFiles`。
3. `features.enableMCP` 和 Sender 内 MCP 控制面删除；连接中的 MCP server 继续由 runtime 暴露，automation 继续由 `allowedMcpServers` 限制。
4. 用户配置改名为 `conversationInstructions`，独立于模型生成参数；最终 `systemPrompt` 只存在于 runtime/provider 内部。
5. `reasoningEffort` 在首轮创建、`/new`、读取和后续 turn 中都能持久化。
6. `compaction` 保持可选。缺失时自动压缩使用 runtime 默认策略；手动命令实际名称是 `/compact`，继续忽略 `enabled` 并主动执行。
7. 面向模型输出上限的字段使用 `maxOutputTokens`，不再与 `contextLength` 混淆。

## Non-negotiable decisions

执行时不得重新讨论或改变以下决策：

- 删除 `ChatFeatures` 以及唯一字段 `enableMCP`。
- 删除 Sender 工具栏中的 MCP 按钮及 `apps/web/src/components/Sender/MCPManagementPanel/`。
- 删除全局 `chatSettings.enableMCP` 和 `setEnableMCP`。MCP 设置页不再有总开关，始终展示 server 配置与连接状态。
- 不删除 MCP runtime、MCP server 配置、连接/断开能力或 automation 的 `allowedMcpServers`。
- `reasoningEffort` 是可选但必须持久化的 generation override。
- `compaction` 是可选策略覆盖，不是 start-turn 必填项，也不是 model config。
- 自动压缩仍由 `SessionRuntime.prepareTask()` 在 agent loop 前检查触发；手动 `/compact` 仍由 command controller 触发。不要合并触发判定。
- 用户会话指令只能追加到 runtime 基础 prompt，不能替换基础 prompt。
- 不引入 compatibility shim、双写或新 Agent Profile。数据库兼容通过一次性 SQLite migration 完成。

## Target contracts

### Conversation persistence

目标共享 schema：

```ts
export const ConversationsSettingsSchema = z.object({
  modelId: z.string(),
  providerId: z.string(),
  temperature: z.number(),
  maxOutputTokens: z.number(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  compaction: CompactionSettingsSchema.optional(),
})

export const ConversationsSchema = z.object({
  id: z.string(),
  workspacePath: z.string().nullable().optional(),
  title: z.string(),
  conversationInstructions: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archived: z.boolean().default(false).optional(),
  settings: ConversationsSettingsSchema,
})
```

说明：

- `conversationInstructions` 存在 conversations 表独立列中，不再位于 settings JSON。
- `settings.compaction` 继续 optional。不要在 Zod 中添加 `.default(...)` 令它落库时必然出现。
- `DEFAULT_COMPACTION_SETTINGS` 是 runtime/UI fallback，不是持久化必填值。
- `maxOutputTokens` 表示模型最大输出，不表示上下文窗口。上下文窗口统一叫 `contextLength`。

### Start turn transport

目标 DTO：

```ts
export interface StartAgentTurnOptions {
  conversationId?: string
  messageContent: IMessageContent
  turnSource?: AgentTurnSource
  workspacePath: string
  mode?: AgentMode
  conversationInstructions?: string // 仅新建 conversation 时消费
  modelConfig: {
    modelId: string
    providerId: string
    temperature?: number
    maxOutputTokens?: number
    reasoningEffort?: ReasoningEffortLevel
  }
}
```

明确禁止重新加入：

- `prompt`
- `content`
- `referencedFiles`
- `selectedSkill`
- `features`
- `systemPrompt`
- `compaction`

### Runtime preparation

`AgentRuntimeStartTaskOptions` 的目标边界：

```ts
interface AgentRuntimeStartTaskOptions {
  // ids/model/provider/workspace/aiProvider/mode/turnSource 保持现有职责
  messageContent: IMessageContent
  conversationInstructions?: string
  modelSettings?: {
    temperature?: number
    maxOutputTokens?: number
    reasoningEffort?: ReasoningEffortLevel
  }
}
```

`PreparedAgentLoopInput`（当前 `RuntimeStartInput`）中允许存在最终 `systemPrompt`，因为此时已经完成 runtime prompt 合成；provider-facing 参数使用 `maxOutputTokens`。

### Workspace reference prompt

在 runtime 固定基础 prompt 中追加以下独立 section。文案保持中文，不要转写成另一个含义：

```text
<workspace_references>
用户消息中的 `@<path>` 表示当前工作区根目录下的相对路径。例如 `@src/app.ts` 表示工作区中的 `src/app.ts`。
该标记只提供路径定位，不表示文件内容已经提供。需要文件内容时，必须使用文件工具读取，不得臆测。
绝对路径或包含 `..` 的路径不得按工作区引用处理；实际路径访问仍必须受工作区边界校验。
</workspace_references>
```

提示词只负责向模型解释语法。真实安全边界仍由 native file tools/path policy 强制执行。

## Current state

### 1. Sender 发送了无效 MCP feature

`apps/web/src/components/Sender/Sender.tsx:81-90`：

```ts
onSubmit?: (
  content: IMessageContent,
  referencedFiles: string[],
  selectedSkill: string | undefined,
  features: ChatFeatures,
  agentMode: AgentMode,
) => ...
```

`apps/web/src/components/Sender/Sender.tsx:827-829`：

```ts
props.onSubmit?.(content, nextReferencedFiles, nextSelectedSkill, {
  enableMCP: mcpEnabled,
}, agentMode)
```

`packages/backend/src/agent-core/tools/toolRegistry.ts:60-69` 实际不读取该 feature。交互 turn 只要 runtime 有 `mcpClientHub`，就加入已连接 MCP tools；automation 通过 `turnSource.allowedMcpServers` 过滤。

### 2. 消息存在多真源

`packages/shared/src/interfaces/agent-runtime-electron.ts:8-20` 同时定义 `prompt`、可选 `content`、`referencedFiles` 和混装的 `modelConfig.features`。

`packages/backend/src/agent-runtime/agentTurnService.ts:87-113` 用 `content` 持久化，却把独立 `prompt` 传给 runtime、标题初始化和 task snapshot。

### 3. `referencedFiles` 只是二次生成 prompt

`apps/web/src/components/Sender/Sender.tsx:547-555` 已经把 `@${file.path}` 插入用户文本，同时把同一路径写入数组。

`packages/backend/src/agent-core/session/turnContext.ts:6-23` 是该字段唯一后端业务作用：把数组重新渲染为隐藏 `<turn_context>`。

### 4. 用户 system prompt 会替换 runtime 基础规则

`packages/backend/src/agent-core/loop/loopContext.ts:23-40`：

```ts
const basePrompt = customPrompt
  ? customPrompt.split('{workspacePath}').join(workspacePath)
  : [/* runtime rules */].join('\n')
```

非空用户输入会删除 workspace、文件工具、重试和执行规则。目标必须改成固定 base rules，再追加 `<conversation_instructions>`。

### 5. reasoningEffort 首轮运行但没有落库

`packages/backend/src/agent-runtime/agentTurnService.ts:72-78` 新建 conversation 时只保存五个旧字段，没有保存 `reasoningEffort`；同文件 `108-113` 又把它传给当前首轮 runtime。因此首轮与第二轮不一致。

`packages/backend/src/agent-runtime/commands/conversationCommands.ts:13-22` 的 `/new` 创建路径也没有保存 `reasoningEffort`。

### 6. compaction 已经是可选字段且存在两条触发链

`packages/shared/src/schemas/conversations.ts:40-41` 中 `reasoningEffort`、`compaction` 都是 optional。

`packages/backend/src/agent-core/session/SessionRuntime.ts:110-128` 在每次 turn 准备时读取可选 compaction 设置，缺失则使用 `DEFAULT_COMPACTION_SETTINGS`，然后检查自动压缩。

`packages/backend/src/agent-runtime/commands/commandController.ts:55-83` 将 `/compact` 路由到独立 command；`compactCommand.ts` 只复用保留 token 设置，并主动执行手动 transaction。

## Repository conventions to preserve

- TypeScript exported API 使用显式类型。
- import 顺序由 ESLint 自动约束：`@ant-chat/*` → external → relative。
- 注释只解释 ownership、限制和设计原因，不逐行翻译代码。
- 测试使用 Vitest，优先断言可观察行为；不要 mock 同仓库内部模块，除非现有测试已经把 runtime/provider 作为系统边界。
- SQLite migration 版本连续，已发布 migration 不得修改；新 migration 必须是 version 4。参考 `packages/backend/src/data/sqlite/migrations/appDataMigrations.ts:13-55`。
- commit 使用中文 Conventional Commit，例如 `refactor(agent-runtime): 收口 turn 输入数据边界`。

## Commands you will need

| Purpose              | Command                                                                                                       | Expected on success                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Web targeted tests   | `pnpm -F @ant-chat/web test -- src/components/Sender src/components/Chat src/hooks src/store/pendingMessages` | exit 0，相关测试全部通过              |
| Backend agent tests  | `pnpm -F @ant-chat/backend test -- src/agent-runtime src/agent-core/session src/agent-core/loop`              | exit 0，相关测试全部通过              |
| Migration tests      | `pnpm -F @ant-chat/backend test -- src/data/sqlite/migrations src/data/sqlite/repositories`                   | exit 0，迁移及 repository 测试通过    |
| Shared typecheck     | `pnpm -F @ant-chat/shared typecheck`                                                                          | exit 0，无类型错误                    |
| Backend typecheck    | `pnpm -F @ant-chat/backend typecheck`                                                                         | exit 0，无类型错误                    |
| Repository typecheck | `pnpm type-check`                                                                                             | exit 0，无类型错误                    |
| Lint autofix         | `pnpm lint --fix`                                                                                             | exit 0，只产生预期格式化/导入排序变更 |
| Full gate            | `pnpm check`                                                                                                  | exit 0                                |
| Production build     | `pnpm build`                                                                                                  | exit 0                                |
| Whitespace check     | `git diff --check`                                                                                            | 无输出，exit 0                        |

如果本机 `better-sqlite3` ABI 导致 migration/repository tests 无法启动，按 STOP condition 报告原始错误；不得把失败测试删除或跳过。

## Suggested executor toolkit

- 修改或新增 Vitest 测试时使用仓库 `behavior-driven-testing` skill。
- 处理 shadcn UI 布局时复用现有 `Switch`、`Button`、`Separator`，不要引入新 UI 依赖。

## Scope

### In scope

以下文件允许修改；测试文件可在同目录新增：

- `packages/shared/src/schemas/conversations.ts`
- `packages/shared/src/interfaces/db-types.ts`
- `packages/shared/src/interfaces/model-service.ts`
- `packages/shared/src/interfaces/agent-runtime-electron.ts`
- `packages/shared/src/interfaces/agent-runtime-interfaces.ts`
- `packages/shared/src/interfaces/builtin-command.ts`
- `packages/shared/src/schemas/providerConfigModels.ts`（仅 `maxTokens` → `maxOutputTokens` 命名迁移）
- `packages/backend/src/data/sqlite/schema.ts`
- `packages/backend/src/data/sqlite/rows.ts`
- `packages/backend/src/data/sqlite/repositories/sqliteConversationRepository.ts`
- `packages/backend/src/data/sqlite/repositories/__tests__/sqliteRepositories.spec.ts`
- `packages/backend/src/data/sqlite/migrations/appDataMigrations.ts`
- `packages/backend/src/data/sqlite/migrations/__tests__/appDataMigrations.spec.ts`
- `packages/backend/src/agent-runtime/agentTurnService.ts`
- `packages/backend/src/agent-runtime/__tests__/agentService.spec.ts`
- `packages/backend/src/agent-runtime/commands/conversationCommands.ts`
- `packages/backend/src/agent-runtime/commands/compactCommand.ts`
- `packages/backend/src/agent-runtime/commands/__tests__/commandController.spec.ts`
- `packages/backend/src/agent-runtime/modelsDev.ts`
- `packages/backend/src/agent-runtime/modelsDevImporter.ts`
- `packages/backend/src/agent-core/session/SessionRuntime.ts`
- `packages/backend/src/agent-core/session/types.ts`
- `packages/backend/src/agent-core/session/turnContext.ts`（删除）
- `packages/backend/src/agent-core/session/__tests__/turnContext.spec.ts`（删除）
- `packages/backend/src/agent-core/loop/loopContext.ts`
- `packages/backend/src/agent-core/loop/agentLoop.ts`
- `packages/backend/src/agent-core/AgentRuntime.ts`
- `packages/backend/src/agent-core/__tests__/AgentRuntime.spec.ts`
- `packages/backend/src/agent-core/ai-providers/multi-provider.ts`
- `packages/backend/src/agent-core/compaction/compactionStrategy.ts`
- `packages/backend/src/agent-core/compaction/__tests__/compactionStrategy.spec.ts`
- `packages/backend/src/agent-runtime/contextTraceService.ts`
- `packages/backend/src/agent-runtime/contextTraceWriter.ts`
- `packages/backend/src/automations/automationService.ts`
- `packages/backend/src/automations/` 下受 DTO 变更影响的测试
- `apps/web/src/components/Sender/Sender.tsx`
- `apps/web/src/components/Sender/inputReferences.ts`
- `apps/web/src/components/Sender/builtinCommandParser.ts`
- `apps/web/src/components/Sender/MCPManagementPanel/`（整个目录删除）
- `apps/web/src/components/Sender/__tests__/`
- `apps/web/src/components/Chat/Chat.tsx`
- `apps/web/src/components/Chat/buildTurnInput.ts`
- `apps/web/src/components/Chat/__tests__/buildTurnInput.spec.ts`
- `apps/web/src/components/Sender/ModelParameterSettingsPanel.tsx`
- `apps/web/src/contexts/chatSettings/`
- `apps/web/src/hooks/useConversationSettings.ts`
- `apps/web/src/hooks/useBuiltinCommandSubmit.ts`
- `apps/web/src/hooks/__tests__/useConversationSettings.spec.ts`
- `apps/web/src/store/chatSettings/`
- `apps/web/src/store/pendingMessages/actions.ts`
- `apps/web/src/store/pendingMessages/__tests__/actions.spec.ts`
- `apps/web/src/store/agentRuntime/__tests__/actions.spec.ts`
- `apps/web/src/pages/Settings/MCPManage/MCPManage.tsx`
- `apps/web/src/pages/Settings/MCPManage/` 下受总开关删除影响的测试
- `packages/ui/src/components/context-usage.tsx`（仅将表示上下文窗口的 `maxTokens` prop 改为 `contextLength`）
- 所有因上述共享类型变更而无法编译的直接测试 fixture；添加前先用 `rg` 证明是直接调用点。

### Out of scope

即使看起来相关，也不要修改：

- MCP backend、MCP client hub、MCP server CRUD、连接/断开实现。
- automation 的 `allowedMcpServers` 和 permission policy。
- compaction transaction、token 估算、summary prompt、compaction event 生命周期。
- 把 `/compact` 重命名为 `/compaction`。仓库命令是 `/compact`。
- 附件预上传或 Web RPC 32 MiB 限制。
- pending message 的 send-time/execution-time 配置语义。
- Agent Profile、预设 persona、跨 conversation 指令模板。
- provider SDK 或 AI SDK 升级。
- theme、布局或无关 Sender 样式调整。
- 用户当前未跟踪的 `docs/plan/agent-loop-core-deepening.md`、`docs/research/`、`prototypes/`。

## Git workflow

- 建议分支：`refactor/turn-input-boundary`
- 每个 batch 一个提交，保持中间提交可 typecheck/test。
- 建议提交顺序：
  1. `test(agent-runtime): 固化 turn 输入与配置语义`
  2. `refactor(data): 分离会话指令并迁移输出 token 字段`
  3. `refactor(web): 删除无效 MCP 开关和 Sender 控制面`
  4. `refactor(chat): 删除文件引用旁路和重复 prompt`
  5. `refactor(agent-runtime): 收口 turn 准备与 prompt 合成`
- 不要执行 `git add .`。按 batch 显式暂存文件。
- 不要 push 或创建 PR，除非操作者另行明确要求。

## Steps

### Step 1: 先写失败的边界行为测试

在改生产代码前补测试，测试行为而不是旧对象形状。

1. `packages/backend/src/agent-runtime/__tests__/agentService.spec.ts`
   - 新 conversation 创建后 `conversation.conversationInstructions` 等于 start-turn 初始指令。
   - settings 中不存在 `systemPrompt`。
   - `reasoningEffort: 'high'` 被持久化，并传入当前 runtime。
   - 未传 `reasoningEffort` 时保持 `undefined`，不注入默认档位。
   - 未传 `compaction` 时创建成功，settings 中不要求该字段。
   - `messageContent` 中多个 text block 时，持久化内容和传给 runtime 的规范化内容一致，不允许第二份 prompt 覆盖。
2. `packages/backend/src/agent-core/__tests__/AgentRuntime.spec.ts` 或 loop context 专用测试：
   - 自定义 conversation instructions 存在时，最终 prompt 仍包含 workspace path、文件工具规则和 `<workspace_references>`。
   - 自定义指令位于 `<conversation_instructions>` 中。
   - 空指令不生成空 section。
3. `packages/backend/src/data/sqlite/migrations/__tests__/appDataMigrations.spec.ts`
   - version 3 旧库包含 `settings.systemPrompt/maxTokens/reasoningEffort/compaction`，迁移后：
     - 新列 `conversation_instructions` 存在；
     - 指令内容迁到新列；
     - settings JSON 删除 `systemPrompt`；
     - `maxTokens` 改为 `maxOutputTokens`；
     - `reasoningEffort` 保留；
     - 有 compaction 时保留，没有时不新增。
4. Web tests：
   - Sender `onSubmit` 不再收到 features、referencedFiles 或 selectedSkill 参数。
   - Sender 工具栏不再渲染 `aria-label="MCP 管理"`。
   - buildTurnInput 只包含 `messageContent`、明确列出的 model config 和 instructions。
   - `/compact` parser 仍拒绝与 `@` 文件引用混用。

**Verify**:

```bash
pnpm -F @ant-chat/web test -- src/components/Sender src/components/Chat
pnpm -F @ant-chat/backend test -- src/agent-runtime src/agent-core src/data/sqlite/migrations
```

预期：新增测试因生产代码尚未迁移而失败，但失败原因必须对应目标行为；不得出现测试自身语法/导入错误。记录失败测试名后进入 Step 2。

### Step 2: 迁移 conversation instructions 与 generation 字段

#### 2.1 更新共享 schema

在 `packages/shared/src/schemas/conversations.ts`：

- 从 `ConversationsSettingsSchema` 删除 `systemPrompt`。
- `maxTokens` 改为 `maxOutputTokens`。
- 保留 optional `reasoningEffort`。
- 保留 optional `compaction`，不要添加默认值。
- 在 `ConversationsSchema` 增加必填 `conversationInstructions: z.string()`。

更新所有 add/update 类型的自动推导，不手写重复 interface。

#### 2.2 新增 SQLite migration version 4

在 `packages/backend/src/data/sqlite/migrations/appDataMigrations.ts` 末尾追加 version 4，不能修改 version 1–3。

迁移必须在同一 transaction 中完成：

1. 若 conversations 不存在 `conversation_instructions`，执行：

   ```sql
   ALTER TABLE conversations
   ADD COLUMN conversation_instructions text NOT NULL DEFAULT ''
   ```

2. 读取所有 `id, settings`。
3. 对每行 `JSON.parse(settings)`：
   - `conversation_instructions = typeof systemPrompt === 'string' ? systemPrompt : ''`
   - 删除 `systemPrompt`
   - 若存在 `maxTokens` 且不存在 `maxOutputTokens`，将值迁到 `maxOutputTokens`
   - 删除 `maxTokens`
   - 不创建 `reasoningEffort`
   - 不创建 `compaction`
   - 已存在的 `reasoningEffort`、`compaction` 原样保留
4. 更新该行的独立列和 settings JSON。

不要依赖 SQLite JSON1 扩展；用 TypeScript 解析，错误 JSON 直接抛错让 migration rollback。

同步更新：

- `schema.ts` 新数据库建表列。
- `ConversationRow`。
- `mapConversationRow()`。
- `CONVERSATION_COLUMNS`。
- repository create/insert/update。
- repository tests 与 migration history expected version 4。

#### 2.3 修复 Web conversation context

`useConversationSettings()` 目标返回：

```ts
{
  settings,
  conversationInstructions,
  updateSettings,
  updateConversationInstructions,
}
```

- `settings` 默认不再有 system prompt。
- `compaction` 默认值在本地 draft 中可以通过 `?? DEFAULT_COMPACTION_SETTINGS` 展示，但不得因为仅打开页面就自动持久化。
- `updateConversationInstructions()` 通过 conversation update action 更新顶层字段。
- `temperature`、输出 token 数值 fallback 使用 `??`，不得用 `||` 破坏合法的 0。

`ModelParameterSettingsPanel`：

- 顶部单独 section 标题“会话指令”，绑定 `conversationInstructions`。
- 分隔后标题“模型参数”，包含 temperature、max output tokens、reasoning effort。
- compaction section 保持独立，文案明确“未设置时使用默认自动压缩策略”。
- 不把会话指令重新塞回 settings。

**Verify**:

```bash
pnpm -F @ant-chat/backend test -- src/data/sqlite/migrations src/data/sqlite/repositories
pnpm -F @ant-chat/web test -- src/hooks src/components/Sender/ModelParameterSettingsPanel.spec.tsx
pnpm -F @ant-chat/shared typecheck
```

预期：migration history 包含 version 1–4；旧数据指令与 reasoning effort 不丢失；Web tests 通过。

### Step 3: 删除 features.enableMCP 与 Sender MCP 控制面

#### 3.1 删除共享 dead contract

- 删除 `ChatFeatures` interface。
- `ModelSettings` 删除 `features`。
- `StartAgentTurnOptions.modelConfig` 删除 `features`。
- `rg "ChatFeatures|enableMCP" packages/shared/src` 必须无结果。

#### 3.2 删除 Web 控制面和状态

- `SenderProps.onSubmit` 删除 features 参数。
- `Sender` 删除 `Cable`、`MCPManagementPanel`、`mcpEnabled` selector 和 MCP popover。
- 删除 `apps/web/src/components/Sender/MCPManagementPanel/` 整个目录。
- `useChatSttingsStore` 只保留 `agentMode`；删除 `enableMCP` 和 `setEnableMCP`。
- `apps/web/src/store/chatSettings/actions.ts` 删除 `setEnableMCP`；若文件因此为空则删除并修正 barrel export。
- `Chat.onSubmit`、`buildTurnInput`、pending-message drain 不再接收/构造 features。

#### 3.3 保留真正的 MCP 管理入口

`apps/web/src/pages/Settings/MCPManage/MCPManage.tsx`：

- 删除“启用 MCP 功能”总开关和 conditional wrapper。
- 页面 mount 时仍执行 `initializeMcpConfigs()`。
- 始终显示“添加服务器”和 `MCPList`。
- 每个 server 的连接/断开操作保持不变。

`packages/backend/src/automations/automationService.ts`：

- 从 startTurn model config 删除 `features`。
- 保留 `turnSource.allowedMcpServers`；不要改 automation 权限语义。

**Verify**:

```bash
rg -n "ChatFeatures|enableMCP|setEnableMCP|MCPManagementPanel" apps/web/src packages/shared/src packages/backend/src
pnpm -F @ant-chat/web test -- src/components/Sender src/pages/Settings/MCPManage src/store/pendingMessages
pnpm -F @ant-chat/backend test -- src/automations src/agent-runtime
```

预期：第一条 `rg` 无结果；Web 中仍能从设置页添加、连接和断开 MCP server；automation tests 继续覆盖 allowed server filtering。

### Step 4: 删除 referencedFiles/selectedSkill 提交旁路

Sender 可以保留编辑器内部 token metadata，但该状态必须：

- 改名为 `confirmedFileReferences` / `confirmedSkillReference`，明确仅服务高亮、光标跳转和整 token 删除。
- 不进入 `SenderProps.onSubmit`。
- 不进入 Chat、RPC、runtime 或持久化 schema。

具体修改：

1. `SenderProps.onSubmit` 收口为：

   ```ts
   onSubmit?: (
     messageContent: IMessageContent,
     agentMode: AgentMode,
   ) => Promise<boolean | void> | boolean | void
   ```

2. Chat 从 `messageContent` 提取文本，用文本语法判断：
   - 是否包含 `@` workspace reference；
   - 是否以 `/skill-name` 开头；
   - 是否为 builtin command。
3. `parseBuiltinCommand` 不再接收 referencedFiles/selectedSkill 数组。通过文本解析保持现有规则：builtin command 不得与 `@` 文件引用或另一个 skill token 混用。
4. 从以下层级删除 `referencedFiles`：
   - `BuildTurnInputOptions`
   - `StartAgentTurnOptions`
   - `AgentRuntimeStartTaskOptions`
   - `agentTurnService`
   - `SessionRuntime`
5. 删除 `turnContext.ts` 和对应单测。
6. 在 `createLoopSystemPrompt()` 固定 sections 中加入 `<workspace_references>` 文案。

不要仅靠 regex 实施真实路径安全。绝对路径、`..`、symlink 越界继续由工具层拒绝。

**Verify**:

```bash
rg -n "referencedFiles|buildPromptWithTurnContext" packages/shared/src packages/backend/src apps/web/src/components/Chat apps/web/src/store apps/web/src/api
pnpm -F @ant-chat/web test -- src/components/Sender src/components/Chat
pnpm -F @ant-chat/backend test -- src/agent-runtime src/agent-core/session src/agent-core/loop
```

预期：第一条 `rg` 只允许命中 Sender 内明确命名的 UI-only `confirmedFileReferences`；backend/shared/transport 零命中。prompt 合成测试通过。

### Step 5: 删除 prompt/content 双真源并收口 start-turn DTO

#### 5.1 Renderer boundary

- `buildTurnInput` 输入使用 `messageContent`，不再接收 `text` 和 optional `content` 两份数据。
- 明确列出 model config 字段，禁止 `...options.settings`：

  ```ts
  modelConfig: {
    modelId: settings.modelId,
    providerId: settings.providerId,
    temperature: settings.temperature,
    maxOutputTokens: settings.maxOutputTokens,
    reasoningEffort: settings.reasoningEffort,
  }
  ```

- `conversationInstructions` 与 modelConfig 平级；已有 conversation 也可发送，但 backend 必须以持久化 conversation 为真源。

#### 5.2 Backend turn service

在 `agentTurnService` 增加一个局部纯函数：

```ts
function extractUserText(content: IMessageContent): string {
  return content
    .filter((block): block is Extract<...> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}
```

行为要求：

- `messageContent` 必填且作为持久化内容原样保存。
- 从其 text blocks 产生唯一 canonical text，用于空输入校验、title 和 task snapshot。
- 不允许调用方额外提供 prompt。
- 仅附件无文本是否允许：保持当前行为——拒绝缺少文本的 turn；不要在本计划改变产品语义。
- 新 conversation 使用请求中的 `conversationInstructions` 和 model config 创建。
- 已有 conversation 使用数据库中的 `conversation.conversationInstructions`；请求字段不得覆盖。
- 新 conversation settings 持久化 `reasoningEffort`（存在时才写）。
- `compaction` 不从 start-turn modelConfig 读取，也不在此处补默认值。

#### 5.3 Runtime boundary

- `AgentRuntimeStartTaskOptions` 接收 `messageContent` 和 `conversationInstructions`。
- `SessionRuntime` 已经重新读取持久化 user message；以该消息 content 构造当前 `LoopMessage`，不要再接收第二份 content。
- 当前 user message 的每个 text block 保留原文，不再全部覆盖成同一个 enriched prompt。
- `RuntimeStartInput.prompt` 如仅用于 task snapshot，可改名 `userText`；如果能直接从 messages 得出且没有独立消费者，则删除。先用 `rg` 确认后选择最小改动。
- 最终 loop messages 只来自 persisted message + persisted history。

**Verify**:

```bash
rg -n "\bprompt:\s|\bcontent\?: IMessageContent|options\.prompt|options\.content" packages/shared/src/interfaces/agent-runtime-electron.ts packages/backend/src/agent-runtime/agentTurnService.ts packages/backend/src/agent-core/session apps/web/src/components/Chat/buildTurnInput.ts
pnpm -F @ant-chat/web test -- src/components/Chat src/store/pendingMessages
pnpm -F @ant-chat/backend test -- src/agent-runtime src/agent-core/session
```

预期：start-turn transport 不再同时出现 prompt/content；测试证明持久化 user message、title 输入和 loop 当前用户文本同源。

### Step 6: 分离 conversation instructions 与最终 systemPrompt

#### 6.1 Prompt assembler

将 `createLoopSystemPrompt(workspacePath, customPrompt, memory)` 改为：

```ts
createLoopSystemPrompt(
  workspacePath: string,
  conversationInstructions?: string,
  memorySnapshot?: LoopSystemPromptMemory,
): string
```

固定顺序：

1. runtime base rules（始终存在）
2. `<workspace_references>`（始终存在）
3. `<skill_reference>`（保持现有）
4. memory guidance / soul / user / memory（保持现有相对顺序）
5. `<conversation_instructions>`（非空才追加）

`{workspacePath}` 替换只应用于 conversation instructions 文本，不用于替换整个 base prompt。

#### 6.2 名称边界

- UI、conversation schema、start-turn DTO、command DTO 只能使用 `conversationInstructions`。
- runtime 合成完成后可以使用 `systemPrompt`。
- provider 内部映射 AI SDK `instructions` 时保留 `systemPrompt` 或改名 `instructions` 均可，但不得让该名称重新泄漏到 conversation settings。
- context diagnostics 中 system prompt 表示最终合成结果，继续独立于 model settings 展示。

#### 6.3 Builtin commands

- `RunBuiltinCommandParams.modelConfig` 删除 `systemPrompt`，添加 optional `reasoningEffort` 与 `maxOutputTokens`。
- `runNew()` 单独接收 `conversationInstructions` 并持久化 reasoning effort。
- `runCompact()` 不需要 conversation instructions；summary 使用自己的 `SUMMARIZATION_SYSTEM_PROMPT`。
- `/fork` 继续复制源 conversation；确认独立列 `conversation_instructions` 一并复制。如果当前 `messageFork.ts` 通过 repository create 手工构造 conversation，必须显式加入该字段。

**Verify**:

```bash
rg -n "settings\.systemPrompt|modelConfig\.systemPrompt|customPrompt" apps/web/src packages/shared/src packages/backend/src
pnpm -F @ant-chat/backend test -- src/agent-core src/agent-runtime/commands
pnpm -F @ant-chat/web test -- src/hooks src/components/Sender src/components/Chat
```

预期：第一条 `rg` 无结果；最终 system prompt tests 证明基础规则不会被会话指令替换。

### Step 7: 统一 maxOutputTokens/contextLength 命名

执行定向命名迁移，不做无关 provider 重构：

- conversation settings: `maxTokens` → `maxOutputTokens`
- provider model catalog 的输出上限: `maxTokens` → `maxOutputTokens`
- model invocation settings: `maxTokens` → `maxOutputTokens`
- AI SDK 调用仍传 `maxOutputTokens`
- compaction summary 的局部常量 `MAX_SUMMARY_TOKENS` 可以保留；它不是公开字段且语义明确
- `ContextUsage` 中当前表示上下文窗口的 prop `maxTokens` 改为 `contextLength`
- 模型真正上下文窗口始终叫 `contextLength`

更新 context diagnostics 文案，不能再显示含义模糊的 `maxTokens`。

迁移后运行：

```bash
rg -n "\bmaxTokens\b" apps/web/src packages/shared/src packages/backend/src
```

允许命中仅限经人工确认的局部统计/兼容迁移读取代码。每个剩余命中必须在 PR 描述中列出原因；conversation、transport、runtime/provider config 不得再命中。

**Verify**:

```bash
pnpm type-check
pnpm -F @ant-chat/web test
pnpm -F @ant-chat/backend test
```

预期：全部 exit 0；temperature 0 测试仍通过；ContextUsage 使用 contextLength。

### Step 8: 清理 fixtures、跑完整 gate、检查 scope

1. 使用 `rg` 找出共享类型迁移导致的所有 fixture，只修改直接受影响处。
2. 运行 lint autofix，复核没有无关格式化扩散。
3. 运行完整测试和 build。
4. 检查工作区，确保用户原有未跟踪文件未被纳入。

**Verify**:

```bash
pnpm lint --fix
pnpm check
pnpm build
git diff --check
git status --short
```

预期：前三条 exit 0；`git diff --check` 无输出；`git status --short` 只包含本计划 scope 文件、`plans/` 和用户原有未跟踪项。

## Test plan

### Required regression cases

#### Shared/schema

- settings 不接受 `systemPrompt`。
- conversation 必须返回 `conversationInstructions`。
- `reasoningEffort` 可缺省，可保存合法档位。
- `compaction` 可缺省；有值时完整解析。
- `maxOutputTokens` 与 `contextLength` 不混用。

#### SQLite migration/repository

- version 3 → 4 正常迁移非空 system prompt。
- 空 system prompt 迁移为空字符串。
- reasoning effort 保留。
- compaction 存在时保留，缺失时仍缺失。
- maxTokens 改名且旧 key 删除。
- migration 第二次执行不重复改写。
- repository create/get/update/fork 都保留 conversation instructions。

#### Web/Sender

- MCP 按钮消失。
- Sender submit 回调仅得到 messageContent 和 agent mode。
- 选择 `@src/a.ts` 后提交文本仍包含 token，但没有 referencedFiles metadata。
- 删除 token 后 UI 高亮状态同步清理。
- builtin command 与 @ reference 混用仍拒绝。
- MCP 设置页始终展示 server 列表和添加按钮，不存在总开关。

#### Agent turn service/runtime

- 首轮 reasoning effort 同时进入 runtime 并落库。
- 第二轮从 conversation settings 读取后保持相同值。
- 未设置 reasoning effort 时 provider 收到 undefined。
- 缺少 compaction override 时 runtime 使用 default automatic policy。
- `compaction.enabled: false` 时自动压缩跳过。
- `/compact` 在 enabled=false 时仍手动执行。
- 用户指令不替换 base rules。
- @ reference section 始终存在。
- 多 text block 不被重复覆盖。
- request 无法让 persisted content 和 runtime user message 分叉。

#### MCP/automation

- interactive turn 不再传 enableMCP。
- 已连接 MCP tools 的现有 registry 行为不变。
- automation 仍只暴露 allowedMcpServers 中的 tools。

### Existing tests to model after

- Web Sender 行为：`apps/web/src/components/Sender/__tests__/Sender.spec.tsx`
- Web turn builder：`apps/web/src/components/Chat/__tests__/buildTurnInput.spec.ts`
- Conversation hook：`apps/web/src/hooks/__tests__/useConversationSettings.spec.ts`
- Agent service：`packages/backend/src/agent-runtime/__tests__/agentService.spec.ts`
- Runtime prompt/turn：`packages/backend/src/agent-core/__tests__/AgentRuntime.spec.ts`
- Migration：`packages/backend/src/data/sqlite/migrations/__tests__/appDataMigrations.spec.ts`
- Manual compaction：`packages/backend/src/agent-runtime/commands/__tests__/commandController.spec.ts`

## Done criteria

全部满足才允许标记 DONE：

- [ ] `features.enableMCP`、`ChatFeatures`、全局 enableMCP store/action 零命中。
- [ ] Sender MCP 按钮和 `MCPManagementPanel` 已删除。
- [ ] MCP 设置页仍能添加、连接、断开 server。
- [ ] automation `allowedMcpServers` 行为与测试保留。
- [ ] start-turn transport 只有 `messageContent`，不存在 prompt/content 双真源。
- [ ] transport/runtime 不存在 `referencedFiles`；Sender 如保留 token metadata，明确是 UI-only。
- [ ] conversation instructions 位于独立 SQLite 列，不在 settings/model config。
- [ ] 自定义会话指令不能替换 runtime base prompt。
- [ ] 首轮发送和 `/new` 都持久化 optional reasoningEffort。
- [ ] compaction 在 schema 中保持 optional；迁移不会给缺失数据强行补字段。
- [ ] 自动压缩与 `/compact` 的差异测试通过。
- [ ] conversation/request/runtime/provider 输出上限使用 `maxOutputTokens`。
- [ ] 上下文窗口使用 `contextLength`。
- [ ] migration version 4 tests 通过且旧 migration 未修改。
- [ ] `pnpm type-check` exit 0。
- [ ] `pnpm lint` exit 0。
- [ ] `pnpm test:unit` exit 0。
- [ ] `pnpm check` exit 0。
- [ ] `pnpm build` exit 0。
- [ ] `git diff --check` 无输出。
- [ ] 没有修改 out-of-scope 文件或用户原有未跟踪文件。
- [ ] `plans/README.md` 状态更新为 DONE。

## STOP conditions

出现以下任一情况立即停止并报告：

1. drift check 显示本计划关键文件在 `3c8c18ac` 后已有语义性修改，且目标 contract 与现状冲突。
2. SQLite migration version 4 已被其他变更占用。不要复用版本号。
3. 发现 production 中有调用方依赖 `features.enableMCP=false` 真正禁用 MCP tools；当前审计结论是后端从未读取它。
4. 删除全局 MCP 开关会导致唯一 MCP 设置入口消失；按当前代码，设置页仍有 server CRUD/连接控制。
5. `reasoningEffort` 并非 model generation override，而在新代码中变成 provider/model capability 字段；不要自行设计双向同步。
6. 实施 conversation instructions 独立列需要修改 out-of-scope 的远程协议或外部兼容格式。
7. 发现 `/compact` 与自动 compaction 已在当前 HEAD 被合并成同一触发判定。不要沿用本计划假设。
8. 仅附件 turn 在当前 HEAD 已被正式支持；本计划假设仍要求至少一个非空 text block。
9. 任一步验证连续两次失败，且失败不是该步骤明确覆盖的直接调用点。
10. `better-sqlite3` ABI/本机环境导致 migration tests 无法运行。保留完整错误并报告，不得伪造通过。

## Maintenance notes

- review 重点不是“类型都改完了”，而是检查每个字段是否只有一个 owner。
- `conversationInstructions` 是用户意图；最终 `systemPrompt` 是 runtime 产物。未来不得再次合并。
- `compaction` 在 conversation settings 中表示策略 override；真正压缩结果通过 message `eventType: 'compaction'` 持久化。两者不是同一个对象。
- 未配置 compaction override 时使用默认自动策略是 runtime 行为，不等于把默认策略写回数据库。
- 如果未来需要 per-turn MCP policy，应设计显式 tool policy，并在 `ToolRegistry.create` 唯一执行；不要恢复 `modelConfig.features`。
- Sender 内保留的 reference token metadata 只能服务编辑体验。任何后端能力必须从消息文本和真实工具 policy 得出。
- 附件预上传、workspace truth source 和 pending queue 配置漂移是已知后续项，但本计划不处理，避免把本次迁移扩成不可评审的大改。
