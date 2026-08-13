# Ant Chat Desktop

## 1.0.0-alpha.6

### Patch Changes

- e2f25dc: 自动化运行状态改为执行事实与收件箱查看态，不再判定成败：

  - `AutomationRunStatus` 收缩为 `queued / running / completed / skipped / cancelled / awaiting`，移除 `succeeded / failed` 成败判定（无人值守下无法可靠判定，模型总结不可信）；审批与 Secret 请求收口为 `awaiting`（等待你操作）。
  - 自动化权限拒绝不再中断 Loop：拒绝结果交回模型继续，可换写法重试或继续其他步骤；run 终态统一 `completed`，异常/拒绝信息保留在 `errorCode / errorMessage`。
  - 新增查看态 `readAt`（收件箱语义：completed 且未打开 = 未读），新增 `automation.markRunRead` 已读接口；自动化页面移除概览统计卡，运行记录列表显示未读标记与「等待你操作」状态。
  - sqlite 迁移 v11：`automation_runs` 增加 `read_at` 列，存量 `succeeded / failed → completed`、`needs_attention → awaiting`。
  - 打包应用解析 login shell PATH 合入命令环境（仅提取 PATH），修复打包后 `execute_command` 找不到 node 等用户工具的问题。

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

## 1.0.0-alpha.5

### Patch Changes

- 消息频道 `/steer` 有运行任务时注入下一个迭代：与 UI 追加指令（`agent.injectSteering`）语义对齐，存在运行/等待审批任务时把指令注入当前任务的下一个迭代；无任务时落库，由下一轮 startTurn 作为历史追加。回复文案按实际结果区分：「已注入当前任务。」/「当前没有运行中的任务，指令已记录，下次任务开始时生效。」
- 修复飞书执行卡片底部服务商/模型信息展示：去掉「模型：」标签前缀，改为单行「服务商 / 模型」灰色小字弱化显示，避免卡片底部视觉过重。

## 1.0.0-alpha.4

### Minor Changes

- 桌面版支持个人微信 iLink 消息频道：设置页新增个人微信接入，支持扫码授权、验证码配对与文本消息收发；owner 身份自动授权，频道消息按终态单条发送。

## 1.0.0-alpha.3

### Patch Changes

- a63a888: 修复打包后内置 visualize Skill 激活失败：Electron asar 不支持 `fs.cp`，内置 Skill 改为逐文件递归复制，兼容安装包内 `app.asar` 路径。

## 1.0.0-alpha.2

### Minor Changes

- 449f8d3: 新增浏览器设置页，支持从本机 Chrome、Edge、Chromium 系浏览器导入 Cookies。导入的登录状态由应用安全保存，并自动用于 Browser 工具及已明确开启 Browser 权限的自动化任务；不会导入密码、历史记录或扩展。
- f77b0ae: 新增 OpenAI Codex 订阅提供商支持：OAuth 订阅登录（含本机 Codex CLI 凭据导入）、固定 endpoint 推理、模型目录自动同步、用量额度查询。引入 Provider Integration 架构，统一 API Key 与订阅型提供商的认证、模型来源、额度与生命周期管理；Provider 配置新增 `integrationId`，RPC 对外返回不含密钥的 `ProviderPublicView`；OAuth 回调服务器改为多 handler 分发，Codex 专用回调端口（1455/1457）惰性启动。
- d7cb250: 统一 execute_command 并拆分 Bash/Windows 命令适配器。将 bash 工具重命名为 execute_command，新增启动期命令宿主探测（Windows 按 pwsh → powershell → cmd 优先级），引入命令风险三级分类和跨平台底线保护，权限规则和自动化配置同步迁移。
- 6166ea9: 统一 npm 产品包与 Desktop 的运行时分发边界：npm 产品包提供 `ant-chat` daemon 和控制 CLI，Desktop 内置同协议 launcher，并分别维护发布版本与 changelog。
- 13678f2: 移除会话级 `temperature` 与 `maxOutputTokens` 配置：模型参数设置面板不再提供这两个滑块，调用模型时不再透传这两个参数，交厂商默认；上下文压缩摘要的内部 token 预算与提供商模型目录的对应字段保留。

### Patch Changes

- 9f57f26: 修复 Ctrl+C 退出开发环境时的错误日志与应用残留

  - 移除 Electron 主进程中不生效的 `process.on('SIGINT'/'SIGTERM'/'SIGHUP')` 处理器（Electron 40 中 Node 信号处理器不会执行，Chromium 会将信号转换为应用退出序列）
  - 退出序列增加兜底超时：renderer 被信号销毁导致窗口关闭握手挂起时强制退出，避免应用残留
  - MCP 传输层主动关闭（dispose/删除）时 `onclose` 降级为 info，不再误报 error
  - 应用退出过程中的 Runtime RPC 失败不再记 error 日志（关闭流程预期噪音）
  - 新增窗口首次加载耗时统计日志（主窗口与设置窗口首次加载完成时记录）
  - 优化开发环境首次加载白屏（约 4 秒 → 约 1.9 秒）：
    - Vite `optimizeDeps` 预构建 `@ant-chat/shared` 与 `@workspace/ui` 子路径模块（含 `.tsx` 扩展声明）
    - `@workspace/ui` 补充根入口 `src/index.ts` 与 package.json `exports["."]`
    - dev server 启动时 warmup 预热首屏模块（`server.warmup`）

- 9f5aa69: 修复 `/fork` 复制会话时消息数据顺序错乱：复制消息现在保留源消息 `created_at`，fork 事件消息改为最后写入，确保新会话消息按源会话时间顺序排列。
- 914c4ae: 桌面端移除独立的设置窗口：设置页并入主窗口，通过 `/settings` 路由进入；侧边栏入口、macOS 应用菜单（Cmd+,）与「返回工作区」均改为窗口内路由跳转。

## 1.0.0-alpha.1

- 首发 macOS arm64/x64 和 Windows x64 安装包。

安装限制：当前安装包未签名或公证。macOS 可能需要在“系统设置 → 隐私与安全性”中手动允许打开，Windows SmartScreen 可能显示未知发布者提示。请只从对应的 GitHub Release 下载。
