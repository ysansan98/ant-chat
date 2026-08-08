# Ant Chat Desktop

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
