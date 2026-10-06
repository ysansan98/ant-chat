# ant-chat

## 1.0.0-alpha.7

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

- 377ba35: 支持工作区技能（`.agents/skills`）：工作区目录内的技能存在即启用、免安装管理，同名时覆盖全局技能，随工作区切换。

  - Turn 技能可见性与 `use_skill` 读取按来源（全局/工作区）分别解析；自动化 `allowedSkills` 与受信路径同样支持工作区技能（backend）。
  - Sender 的 `/` 技能面板与发送链路的已知技能解析均合并工作区技能，同名工作区版本优先（web）。
  - 新增 `skills.listWorkspaceSkills` RPC、`SkillReader.listWorkspaceSkills` / `readWorkspaceSkillMarkdown` 接口，`SkillSource` 新增 `workspace`（shared）。
  - 安全：realpath 校验防 symlink 逃逸、跳过隐藏与构建目录、名称白名单、扫描深度上限 4。

### Patch Changes

- d649a8e: 修复图像生成的产物交付与开发环境路径：

  - 桌面会话中 `send_attachment` 的附件此前只写入消息、不参与渲染：助手消息 content 里的图片/文档/文件附件块现在在回复中原位展示（图片走缩略图与全屏预览、文档/文件走卡片），不再静默消失。
  - `ant-chat image generate` 的 `--output` 相对路径改为按调用者 cwd 解析：开发环境 wrapper 此前把 CLI 进程 cwd 固定在 `packages/ant-chat`，导致缺省 `./generated` 落到包目录而非工作区。
  - `GenerationModule` 对非绝对路径的产物目录直接报错，不再静默按后端进程 cwd 解析（后端与调用者 cwd 不同）。

- 4f72585: 修复消息跳转导航（消息列表右侧的圆点 rail）定位：改为锚定消息列表容器而非视口，右侧栏展开后不再被压在侧栏上，并随侧栏伸缩同步移动。
- ef91576: 服务商模型列表支持过滤与批量启停：新增按模型名称/ID 搜索、全选 checkbox（作用于当前筛选结果，一次落盘）与行内启停开关；模型名称后展示能力标签（工具调用、推理、图片、PDF、视频、音频）。配套新增 `provider.setModelsEnabledStatus` 批量 RPC，避免逐个模型重复写设置文件。
- a54dcf3: LLM 请求适配 OpenCode Go 标识要求：

  - 所有 Provider 出站请求的 `User-Agent` 统一为 `ant-chat/<version>`（fetch 层覆盖，不再出现 AI SDK 默认标识）；版本由宿主注入：desktop 取 `app.getVersion()`，npm 包取构建期注入版本。
  - 发往 `opencode.ai` 的会话内请求新增 `x-opencode-session: <conversationId>` 请求头（主循环、标题生成、自动/手动压缩统一透传，同一对话内稳定）。
  - `IAIProvider.streamModel/complete` 新增可选 `conversationId` 字段（向后兼容）；`createCompactionStrategy` 工厂新增可选 `conversationId` 参数。

- 7c03e23: 服务商 API Key 配置修复与体验调整：

  - 修复失焦误删密钥：API Key 输入框在聚焦后失焦（含点击「显示密码」按钮导致的失焦）会提交空值，而后端把空 `apiKey` 视为"删除密钥"，导致已保存的 Key 被清掉。现在输入过程与失焦都不落盘，编辑后才出现「保存 / 取消」，Enter 保存、Esc 取消，清空后按钮显示「清除密钥」。
  - 占位符明确显示「已配置，输入新 Key 可替换」/「未配置」，不再用 `••••••••` 表示状态；移除右侧「显示密码」入口，输入框始终掩码。
  - `hasApiKey` 改为以 Keychain 中实际存在密钥为准：内置 Provider 预置的 `apiKeySecretId` 只表示密钥存放位置，此前被误当成"已配置"，导致从未配置过的服务商也显示已配置（`ant-chat provider list` 的 KEY 列同步修正）。

## 1.0.0-alpha.6

### Minor Changes

- b412a08: 模型回复批注：支持对模型回复选中文本添加批注（引用 + 评论），随用户消息发送给模型

  - 发送前编辑态：选区批注、序号气泡、点击复现高亮、编辑/删除（临时状态，不落库）
  - 发送：批注组装为 `annotation` blocks 随用户消息落库，上下文渲染为 `<annotation><quote>/<comment>` 结构化文本注入模型
  - 发送后展示：用户消息渲染"n条注释"按钮 + hover 列表；Sender 输入框上方预览，可跳转回引用消息原位编辑
  - 消息内容新增 `annotation` block 类型（schema 扩展，无数据库迁移）

### Patch Changes

- 73cef66: 批注发送前体验收尾：Sender 批注预览改为附件 chip 形态（与附件同高、hover 显示关闭按钮一键清空全部草稿），序号标记改为气泡+角标形态并换 amber 强调色
- f1b3d1e: 系统通知：应用失焦时 turn 执行完成发送系统级通知（Web 与桌面端均支持），点击通知聚焦应用并跳转到对应会话页

  - 渲染层新增 `useTurnFinishedNotification`：监听 `agent:turn-finished`，仅当应用失焦（`document.hasFocus()` 为 false）时通过系统 Notification 提醒，success/error 均通知、cancel 不通知；同一会话的通知互斥替换（tag）。
  - Web 端在首次用户交互时申请 Notification 权限，未授权时发送前再补一次申请。
  - 桌面端新增 `app.focusWindow` IPC：点击通知时主进程恢复最小化/隐藏窗口并聚焦；路由跳转到 `/chat` 并激活对应会话（含跨工作区）。

- 1cc5300: 修复添加工作区时目录选择器对 Windows 的适配：面包屑不再在前端按 '/' 拆分路径（此前 Windows 路径被折叠成单个 "/"、点击后跳到无效路径），改由后端按平台返回逐级面包屑；多盘符时切换盘符的下拉合并进面包屑首段（如 C: ▾ / Users / me），可直接切换盘符。

## 1.0.0-alpha.5

### Minor Changes

- e2f25dc: 自动化运行状态改为执行事实与收件箱查看态，不再判定成败：

  - `AutomationRunStatus` 收缩为 `queued / running / completed / skipped / cancelled / awaiting`，移除 `succeeded / failed` 成败判定（无人值守下无法可靠判定，模型总结不可信）；审批与 Secret 请求收口为 `awaiting`（等待你操作）。
  - 自动化权限拒绝不再中断 Loop：拒绝结果交回模型继续，可换写法重试或继续其他步骤；run 终态统一 `completed`，异常/拒绝信息保留在 `errorCode / errorMessage`。
  - 新增查看态 `readAt`（收件箱语义：completed 且未打开 = 未读），新增 `automation.markRunRead` 已读接口；自动化页面移除概览统计卡，运行记录列表显示未读标记与「等待你操作」状态。
  - sqlite 迁移 v11：`automation_runs` 增加 `read_at` 列，存量 `succeeded / failed → completed`、`needs_attention → awaiting`。
  - 打包应用解析 login shell PATH 合入命令环境（仅提取 PATH），修复打包后 `execute_command` 找不到 node 等用户工具的问题。

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

### Patch Changes

- e2ce6cd: 开发环境与生产环境的数据和 Keychain 隔离

  - 新增 `ANT_CHAT_ENV` 环境变量（默认 `production`）：development 下数据目录使用 `~/.ant-chat-dev`、Keychain service 使用 `ant-chat-dev`，与生产的 `~/.ant-chat` / `ant-chat` 互不共享。
  - `KeychainSecretStore` 的 service 名改为实例参数，由 `createRuntimeCore` 按运行环境注入；dev（无签名 Electron 二进制）与 prod（打包签名应用）是两个签名不同的可执行文件，共用同一批 Keychain 条目会反复触发 macOS 钥匙串授权弹窗，隔离后互不干扰。
  - `pnpm dev` / `pnpm dev:web` 自动注入 `ANT_CHAT_ENV=development`；CLI 需要开发隔离时手动设置该变量。

## 1.0.0-alpha.4

### Patch Changes

- 消息频道 `/steer` 有运行任务时注入下一个迭代：与 UI 追加指令（`agent.injectSteering`）语义对齐，存在运行/等待审批任务时把指令注入当前任务的下一个迭代；无任务时落库，由下一轮 startTurn 作为历史追加。回复文案按实际结果区分：「已注入当前任务。」/「当前没有运行中的任务，指令已记录，下次任务开始时生效。」
- 修复飞书执行卡片底部服务商/模型信息展示：去掉「模型：」标签前缀，改为单行「服务商 / 模型」灰色小字弱化显示，避免卡片底部视觉过重。

## 1.0.0-alpha.3

### Minor Changes

- 77b841a: 消息频道出站附件：微信 iLink 与飞书支持发送文件/图片/文档。频道会话中 agent 通过 `send_attachment` 工具直接把工作区文件发送到当前会话并返回真实消息 ID，发送失败会反馈给模型；桌面会话则作为附件附加到回复。

## 1.0.0-alpha.2

### Minor Changes

- 449f8d3: 新增浏览器设置页，支持从本机 Chrome、Edge、Chromium 系浏览器导入 Cookies。导入的登录状态由应用安全保存，并自动用于 Browser 工具及已明确开启 Browser 权限的自动化任务；不会导入密码、历史记录或扩展。
- 6135228: 新增 agent-browser 工具与运行时集成。浏览器按 conversation 隔离 daemon、profile 和 session，并在多个 turn 间复用；runner 优先使用系统 PATH 中的外部 CLI，未找到时回退到 npx，并缓存发现结果，不随应用绑定 agent-browser 版本；补充受控页面读取能力，禁止通过 Bash 绕过浏览器工具。
- f77b0ae: 新增 OpenAI Codex 订阅提供商支持：OAuth 订阅登录（含本机 Codex CLI 凭据导入）、固定 endpoint 推理、模型目录自动同步、用量额度查询。引入 Provider Integration 架构，统一 API Key 与订阅型提供商的认证、模型来源、额度与生命周期管理；Provider 配置新增 `integrationId`，RPC 对外返回不含密钥的 `ProviderPublicView`；OAuth 回调服务器改为多 handler 分发，Codex 专用回调端口（1455/1457）惰性启动。
- c8b903c: 重构应用 runtime、Turn intake、会话与工作区生命周期、MCP 生命周期和自动化调度边界；统一失败回滚、资源释放与事件发布语义。
- d7cb250: 统一 execute_command 并拆分 Bash/Windows 命令适配器。将 bash 工具重命名为 execute_command，新增启动期命令宿主探测（Windows 按 pwsh → powershell → cmd 优先级），引入命令风险三级分类和跨平台底线保护，权限规则和自动化配置同步迁移。
- 6166ea9: 统一 npm 产品包与 Desktop 的运行时分发边界：npm 产品包提供 `ant-chat` daemon 和控制 CLI，Desktop 内置同协议 launcher，并分别维护发布版本与 changelog。
- 13678f2: 移除会话级 `temperature` 与 `maxOutputTokens` 配置：模型参数设置面板不再提供这两个滑块，调用模型时不再透传这两个参数，交厂商默认；上下文压缩摘要的内部 token 预算与提供商模型目录的对应字段保留。

### Patch Changes

- 9f5aa69: 修复 `/fork` 复制会话时消息数据顺序错乱：复制消息现在保留源消息 `created_at`，fork 事件消息改为最后写入，确保新会话消息按源会话时间顺序排列。

## 1.0.0-alpha.1

- 首发本地 Agent Runtime、Web UI、RPC、SSE 和控制 CLI。
