# @ant-chat/shared

## 1.0.0-alpha.2

### Minor Changes

- 77a5e4c: Agent 消息搜索与人工批准的长期记忆目录（MemoryCatalog）

  - 新增 migration v9：`messages.ordinal`（会话内稳定排序键）、`message_search_documents` / `message_tool_facts` 搜索投影、`messages_fts_unicode` / `messages_fts_trigram` 双 FTS（trigram 不可用时显式降级为 LIKE）、`memories` / `memory_evidence` 长期记忆表。
  - 新增 Agent 专用消息搜索后端（`search_messages` / `get_thread` / `get_turn` 三个只读工具）：英文/路径走 unicode61、CJK ≥3 字走 trigram、1–2 字走转义 LIKE；`search_messages` 支持 `tool_name` / `server_name` 精确过滤（基于 `message_tool_facts` 结构化事实）；`get_turn` 返回本 turn 用户根消息、同 turn 消息与关联 compaction boundary。
  - 新增 `search_memories` / `propose_memory` 工具：记忆由 agent 提议（pending），仅用户在 UI 批准后生效并写入 `app-data/memories/<workspace-key>/`；自动化 turn 无权提议或批准。
  - 恢复 agent 主动维护全局记忆快照的 `memory` 工具（USER.md / MEMORY.md，仅交互式 turn；automation 无权）；需人工批准的项目结论仍走 `propose_memory`（MemoryCatalog）。
  - 新增「长期记忆」设置页：待批准/已批准/已归档三个视图，支持批准、归档、查看正文与证据回跳（跳转到对应会话消息）。
  - 前端 `search.searchByKeyword` RPC 与 `messages` 表语义保持不变。

- 893be45: 新增 AI Native 应用控制契约与 `ant-chat` CLI，支持设置、服务商、MCP 和自动化管理。
- 6135228: 新增 agent-browser 工具与运行时集成。浏览器按 conversation 隔离 daemon、profile 和 session，并在多个 turn 间复用；runner 优先使用系统 PATH 中的外部 CLI，未找到时回退到 npx，并缓存发现结果，不随应用绑定 agent-browser 版本；补充受控页面读取能力，禁止通过 Bash 绕过浏览器工具。
- 90afafd: 增加会话归档、恢复和归档管理能力，并将工作区侧边栏会话预览限制为最近五个。
- c8b903c: 重构应用 runtime、Turn intake、会话与工作区生命周期、MCP 生命周期和自动化调度边界；统一失败回滚、资源释放与事件发布语义。
- a5511b3: 支持在对话设置中配置「推理强度（reasoning effort）」，端到端打通：

  - models.dev 同步 `reasoning_options` 能力，导入时归一化为 ai-sdk v7 档位（`max`→`xhigh`，丢弃未知档位），落库模型能力 `reasoningLevels`。
  - 共享层新增 `ReasoningEffortSchema` / `ReasoningEffortLevel` 类型与 `mapModelsDevEffortToV7` 映射函数；`ConversationsSettingsSchema`、`ModelSettings`、`IAIProvider.streamModel` 等接口增加 `reasoningEffort`。
  - 后端沿 `agentTurnService` → `SessionRuntime` → `agentLoop` → `MultiProvider` 透传，最终通过 ai-sdk v7 统一 `reasoning` 参数下发（仅设值时传）。
  - 内置命令路径（`/compact`）补齐：`RunBuiltinCommandParams.modelConfig` 增加 `reasoningEffort`，`createCompactionStrategy` 以闭包捕获并透传到 `MultiProvider.complete` 的 `generateText({ reasoning })`；前端 `useBuiltinCommandSubmit` 与 `Chat` 同步该字段。
  - 前端「模型参数」面板在模型具备 `reasoningLevels` 时渲染推理强度下拉，并同步到对话设置。

### Patch Changes

- ac16c9b: 升级 AI SDK 到 v7（`ai@^7.0.18` 及 `@ai-sdk/*` provider 包 v4/v3），并重构 `MultiProvider` 实现：用 `PROVIDER_FACTORIES` 表消除 provider 分支与 `any`；系统提示改用 `instructions` 选项；消息转换返回类型化 `ModelMessage[]`（图片部件改为 `file`）；流式遍历 `result.stream`（`TextStreamPart` 类型化，删除 `usedFullStream`/`textStream` 死代码分支）；`usage` 收敛为单一 `await result.usage` 来源；`complete`/`createConversationTitle`/`validateConnection` 改用 `generateText`；`normalizeUsage` 源读取改 `outputTokenDetails.reasoningTokens` / `inputTokenDetails.cacheReadTokens`。对外契约 `streamModel`/`complete` 保持不变。
- d0e2eb6: 为 MCP server 增加启用/禁用开关：禁用后不再随应用启动自动连接并立即停止；MCP 配置页回填真实连接状态，不再误显示为已停止。
  MCP 配置页改为左右分栏：左侧服务器列表、右侧展示选中服务器的工具列表，并移除 MCP server 的 icon 字段。
  修复 MCP OAuth server 认证失效后无法重新授权的问题：McpModule 现在会把回调地址注入连接管理器，
  401 或 refresh token 失效时自动清除旧凭据并重新发起浏览器授权，而不是直接报 Unauthorized。
  应用启动的自动连接不再弹交互式 OAuth 授权窗口：需要重新授权时保持未运行，
  由用户在 MCP 设置页点击启动按钮时再发起授权。
- 3e473c0: 明确执行轨迹的采集态与完成态，仅在 Turn 终态落盘后通知已打开的面板刷新，并完善取消、失败和不完整 Trace 的展示。
- 0ffdbf0: 将工具白名单收紧为精确的记忆授权能力，统一审批持久化 owner，并在执行轨迹中分别展示基础判定和最终依据。
- 914c4ae: 桌面端移除独立的设置窗口：设置页并入主窗口，通过 `/settings` 路由进入；侧边栏入口、macOS 应用菜单（Cmd+,）与「返回工作区」均改为窗口内路由跳转。
