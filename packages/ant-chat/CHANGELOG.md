# ant-chat

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
