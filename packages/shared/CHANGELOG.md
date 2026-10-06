# @ant-chat/shared

## 1.0.0-alpha.6

### Minor Changes

- c631d22: 新增外部可扩展的 hooks 机制（P0–P1，共 11 个事件）：

  - 运行时内核：两层配置（`~/.ant-chat/hooks.json` + `<workspace>/.agents/hooks.json`）、command handler 执行、stdin JSON 协议、超时与失败隔离、deny/ask 聚合；`developerTools.agentHooksEnabled` 总开关（默认开启）。
  - P0 事件：`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`。
  - P1 事件：`PermissionRequest`、`PreCompact`、`PostCompact`、`Interrupt`、`Notification`。
  - 安全顺序：policy 先行，hook 只收紧；`PreToolUse` 的 `deny` 直接阻断，`ask` 复用现有审批流（automation 降级为阻断）。
  - 配置损坏按"无 hook"处理并隔离损坏文件；hook 超时/崩溃/解析失败不阻塞主流程。

- ff50775: 支持会话级后台命令执行（P1 全范围）：

  - `execute_command` 新增 `runInBackground`：命令在会话级 `BackgroundCommandManager` 中运行并跨 turn 存活；后台模式忽略默认 10s 超时，显式 `timeoutMs` 降级为看门狗。
  - 新增三个工具：`read_command_output`（按字节 offset 增量读取、`waitMs` 有界等待）、`kill_command`（终止进程组，SIGTERM → 1s 宽限 → SIGKILL）、`list_commands`。
  - 日志落盘 `<appDataRoot>/commands/logs/<commandId>.log`，合并 stdout/stderr、20MB 上限截断、密钥按块流式脱敏；会话关闭与 Runtime dispose 回收进程，App 启动时扫描状态文件按命令指纹回收孤儿进程组。
  - agent 感知：命令结束（自然退出 / 用户终止 / 看门狗超时）进入会话通知队列。Turn 运行中在每轮模型调用前注入 `<background_command_notices>` 上下文；Turn 之间在下一次 systemPrompt 呈现一次，不自动唤醒新 turn。agent 自己发起的 `kill_command` 与会话关闭 / 应用退出不回队；agent 已通过 `read_command_output` 读到终态时通知被消费。
  - 会话级 RPC 与事件：`agent.listBackgroundCommands` / `agent.killBackgroundCommand` / `agent.readBackgroundCommandOutput` 与 `agent:background-commands-updated`；Sender 新增后台命令面板（横向胶囊组 + 悬停日志与终止）。
  - 后台命令与前台共用同一风险判定与审批路径；持有 Turn 密钥的后台进程在日志头部、工具结果与 UI 中标注审计。

- 96dd8d0: ModelScope 图像生成能力与超时/取消调用方化

  - 内置服务商新增 **ModelScope（魔搭）**：固定 `https://api-inference.modelscope.cn/v1` endpoint、API Key 认证；「同步模型」合并 models.dev 的 chat 模型与内置生图清单（`Qwen/Qwen-Image`、`Tongyi-MAI/Z-Image-Turbo`），老配置启动时自动补上该预置 Provider。
  - 新增 CLI 命令 `ant-chat image generate --prompt <提示词> [--width --height] [--output <目录>] [--timeout <毫秒>] [--json]`：阻塞等待生成完成，产物落盘到 `--output`（缺省 `./generated`，按 CLI 进程 cwd 解析为绝对路径）并在 `--json` 返回 `files[].path`；模型一律来自设置页「图像生成模型」配置（CLI 不暴露模型参数）。
  - Provider 语义升级：`ProviderIntegration` 新增 `mediaGeneration` 能力通道（按 image/video 分类，未声明能力 fail closed）；新增 ModelScope（魔搭）Integration——固定 endpoint + API Key 认证，models.dev chat 模型与内置生图清单合并，异步 submit + 3s 轮询 + 独立下载（同 host 才带凭据）。
  - 设置页新增「图像 → 图像生成模型」选择器（按 `outputModalities` 含 image 过滤）；「添加模型」表单支持标注输出类型（图片/视频），手填生图模型（决策 1）可进入选择器。
  - bundled SKILL `image-generation`：agent 通过 `execute_command` 调用（必须显式传 `timeoutMs`，如 300000）；生成完成后必须用 `send_attachment` 把图发给用户（桌面附加到回复、频道直接发送）。
  - 超时调用方化：CLI 响应等待不再有 120s 系统默认——`--timeout` 显式设置并同时透传后端生成总超时；未传时阻塞等待，由外层调用者（`execute_command timeoutMs` / Ctrl-C）兜底。
  - 断连传播为 AbortSignal：CLI 超时自杀 / Ctrl-C / 进程被杀时，控制面仅在「请求执行中、响应尚未写回」时取消执行，停止后端轮询，避免额度白扣；`image recognize` 迁移到同一超时规则。

### Patch Changes

- a54dcf3: LLM 请求适配 OpenCode Go 标识要求：

  - 所有 Provider 出站请求的 `User-Agent` 统一为 `ant-chat/<version>`（fetch 层覆盖，不再出现 AI SDK 默认标识）；版本由宿主注入：desktop 取 `app.getVersion()`，npm 包取构建期注入版本。
  - 发往 `opencode.ai` 的会话内请求新增 `x-opencode-session: <conversationId>` 请求头（主循环、标题生成、自动/手动压缩统一透传，同一对话内稳定）。
  - `IAIProvider.streamModel/complete` 新增可选 `conversationId` 字段（向后兼容）；`createCompactionStrategy` 工厂新增可选 `conversationId` 参数。

- 0e68fc2: AI 服务商设置优化：添加模型弹窗新增"推理强度"档位配置（reasoningLevels），布局改为两列紧凑排布并加宽弹窗，关闭时清空表单；移除"默认temperature"字段（保存默认 0.7）。添加服务商弹窗移除"产品集成"选择，统一按 API Key 集成提交（订阅/OAuth 服务商为内置，不走此入口）。models.dev 同步不再把空 modalities 写入 capabilities；OutputModalitiesSchema 枚举扩展为与 models.dev 对齐（text/image/video/audio/pdf），避免同步含视频/音频输出模型后 settings 校验失败。
- 377ba35: 支持工作区技能（`.agents/skills`）：工作区目录内的技能存在即启用、免安装管理，同名时覆盖全局技能，随工作区切换。

  - Turn 技能可见性与 `use_skill` 读取按来源（全局/工作区）分别解析；自动化 `allowedSkills` 与受信路径同样支持工作区技能（backend）。
  - Sender 的 `/` 技能面板与发送链路的已知技能解析均合并工作区技能，同名工作区版本优先（web）。
  - 新增 `skills.listWorkspaceSkills` RPC、`SkillReader.listWorkspaceSkills` / `readWorkspaceSkillMarkdown` 接口，`SkillSource` 新增 `workspace`（shared）。
  - 安全：realpath 校验防 symlink 逃逸、跳过隐藏与构建目录、名称白名单、扫描深度上限 4。

## 1.0.0-alpha.5

### Minor Changes

- b412a08: 模型回复批注：支持对模型回复选中文本添加批注（引用 + 评论），随用户消息发送给模型

  - 发送前编辑态：选区批注、序号气泡、点击复现高亮、编辑/删除（临时状态，不落库）
  - 发送：批注组装为 `annotation` blocks 随用户消息落库，上下文渲染为 `<annotation><quote>/<comment>` 结构化文本注入模型
  - 发送后展示：用户消息渲染"n条注释"按钮 + hover 列表；Sender 输入框上方预览，可跳转回引用消息原位编辑
  - 消息内容新增 `annotation` block 类型（schema 扩展，无数据库迁移）

### Patch Changes

- 36d7239: 修复打包版 macOS 桌面端浏览器工具找不到 agent-browser CLI 的问题：打包版 GUI 由 launchd 启动，进程 PATH 不含用户 shell 注入的目录（nvm/homebrew 等），浏览器工具解析外部 CLI 时未使用与 execute_command 相同的合并 PATH。现在宿主注入的 commandEnvironment（login shell PATH + 应用自带目录）会透传到浏览器工具的命令解析与子进程环境，打包版也能找到全局安装的 agent-browser；同时 browserRunner 测试改为不依赖真实 node bin 目录，避免被全局安装的 agent-browser 干扰。
- f1b3d1e: 系统通知：应用失焦时 turn 执行完成发送系统级通知（Web 与桌面端均支持），点击通知聚焦应用并跳转到对应会话页

  - 渲染层新增 `useTurnFinishedNotification`：监听 `agent:turn-finished`，仅当应用失焦（`document.hasFocus()` 为 false）时通过系统 Notification 提醒，success/error 均通知、cancel 不通知；同一会话的通知互斥替换（tag）。
  - Web 端在首次用户交互时申请 Notification 权限，未授权时发送前再补一次申请。
  - 桌面端新增 `app.focusWindow` IPC：点击通知时主进程恢复最小化/隐藏窗口并聚焦；路由跳转到 `/chat` 并激活对应会话（含跨工作区）。

- 1cc5300: 修复添加工作区时目录选择器对 Windows 的适配：面包屑不再在前端按 '/' 拆分路径（此前 Windows 路径被折叠成单个 "/"、点击后跳到无效路径），改由后端按平台返回逐级面包屑；多盘符时切换盘符的下拉合并进面包屑首段（如 C: ▾ / Users / me），可直接切换盘符。

## 1.0.0-alpha.4

### Minor Changes

- e2ce6cd: 开发环境与生产环境的数据和 Keychain 隔离

  - 新增 `ANT_CHAT_ENV` 环境变量（默认 `production`）：development 下数据目录使用 `~/.ant-chat-dev`、Keychain service 使用 `ant-chat-dev`，与生产的 `~/.ant-chat` / `ant-chat` 互不共享。
  - `KeychainSecretStore` 的 service 名改为实例参数，由 `createRuntimeCore` 按运行环境注入；dev（无签名 Electron 二进制）与 prod（打包签名应用）是两个签名不同的可执行文件，共用同一批 Keychain 条目会反复触发 macOS 钥匙串授权弹窗，隔离后互不干扰。
  - `pnpm dev` / `pnpm dev:web` 自动注入 `ANT_CHAT_ENV=development`；CLI 需要开发隔离时手动设置该变量。

- 80f4283: 纯文本模型图片附件的图像识别闭环

  - 目标模型不支持图片输入时，运行时把图片附件替换为 `file_id` 汇总占位符，并引导 agent 调用识别命令逐张识别。
  - 新增 CLI 命令 `ant-chat image recognize`（`--path` / `--file-id` / `--prompt` / `--provider-id` / `--model-id` / `--json`）：工作区图片按绝对路径读取，聊天附件按 `file_id` 走应用内附件存储；图片校验 png/jpg/jpeg/webp/gif 且 ≤10MB，识别模型默认取设置页配置的视觉模型。
  - 设置页新增「视觉模型 → 图像识别模型」配置（仅列出支持图片输入的模型）。
  - bundled SKILL `image-recognition`：agent 通过 `execute_command` 主动调用；调用需显式传 `timeoutMs: 150000`（视觉识别是同步模型调用，默认 10 秒超时不够）。
  - 开发环境 `ant-chat` launcher 改为纯 CLI（node + tsx），不依赖 pnpm 与调用方 cwd；CLI 连接实际运行中的 Runtime（残留端点提示 + dev/prod 默认根回退）。

- 831d10e: 统一右侧辅助栏，支持工作区文件树浏览与文件预览

  - 新增统一 `RightSidebar`：标签页模型（文件 / Trace），支持多个文件标签 + 唯一 Trace 标签；窄屏（≤767px）降级为 Sheet，宽屏为可拖拽宽度侧栏；右上角常驻开关按钮。Trace 面板从独立 Sheet 重构为侧栏内嵌内容，入口从标题栏按钮改为右上角开关。
  - 新增文件管理器：工作区文件树懒加载（目录展开按需拉取）、目录/文件名称排序、语言推断与图标；文件名模糊搜索；文件树列宽与右侧栏宽度可拖拽调节（树宽持久化，栏宽每次启动恢复默认）。
  - 新增文件预览：文本文件（1MB 上限、二进制嗅探，binary/oversize 展示中性提示）、Markdown（Preview/Source 双模式，复用 streamdown 静态渲染）、图片/音视频（原生流式）、Excel/PDF/DOCX（WASM 只读渲染）、不支持类型中性提示；「用默认软件打开」调用系统默认应用。
  - 后端新增 RPC：`workspace.listDirectoryEntries` / `workspace.readTextFile` / `workspace.openWithDefaultApp` / `workspace.resolveFileForStream`；路径校验拒绝绝对路径/盘符/反斜杠/`..`，realpath 阻断符号链接逃逸，单目录枚举上限 2000 条。
  - 文件流式预览双通道：Web 走本地 HTTP 端点 `/api/workspace/file`（支持 Range），Electron 走自定义 `antchat-ws-file` scheme（protocol.handle + net.fetch）；安全校验统一收敛到后端 `workspace.resolveFileForStream`。

## 1.0.0-alpha.3

### Minor Changes

- 77b841a: 消息频道出站附件：微信 iLink 与飞书支持发送文件/图片/文档。频道会话中 agent 通过 `send_attachment` 工具直接把工作区文件发送到当前会话并返回真实消息 ID，发送失败会反馈给模型；桌面会话则作为附件附加到回复。

### Patch Changes

- 37a7bef: 浏览器身份改为惰性加载：应用启动不再预热读取钥匙串中的 Cookie 加密密钥，只有真正执行浏览器工具或打开浏览器设置页时才访问钥匙串；首次执行浏览器工具前会补读 Turn 创建时的空快照。同时移除旧版 settings.json 明文 API Key 的启动迁移，明文 apiKey 不再是合法持久化状态，凭据只通过 apiKeySecretId 引用 Keychain。

  浏览器托管会话不再创建或使用独立 profile 目录：命令不再传 `--profile`，依赖 agent-browser 的 `--session` 临时隔离实例，会话关闭即失效、磁盘不保留登录态；显式系统 Chrome Profile 能力保留。`browser_navigate` 新增 `injectCookies` 参数（默认 true），agent 可显式关闭托管 Cookies 注入，以未登录状态访问页面。

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
