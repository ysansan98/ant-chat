# @ant-chat/control-client

## 1.0.0-alpha.4

### Minor Changes

- 96dd8d0: ModelScope 图像生成能力与超时/取消调用方化

  - 内置服务商新增 **ModelScope（魔搭）**：固定 `https://api-inference.modelscope.cn/v1` endpoint、API Key 认证；「同步模型」合并 models.dev 的 chat 模型与内置生图清单（`Qwen/Qwen-Image`、`Tongyi-MAI/Z-Image-Turbo`），老配置启动时自动补上该预置 Provider。
  - 新增 CLI 命令 `ant-chat image generate --prompt <提示词> [--width --height] [--output <目录>] [--timeout <毫秒>] [--json]`：阻塞等待生成完成，产物落盘到 `--output`（缺省 `./generated`，按 CLI 进程 cwd 解析为绝对路径）并在 `--json` 返回 `files[].path`；模型一律来自设置页「图像生成模型」配置（CLI 不暴露模型参数）。
  - Provider 语义升级：`ProviderIntegration` 新增 `mediaGeneration` 能力通道（按 image/video 分类，未声明能力 fail closed）；新增 ModelScope（魔搭）Integration——固定 endpoint + API Key 认证，models.dev chat 模型与内置生图清单合并，异步 submit + 3s 轮询 + 独立下载（同 host 才带凭据）。
  - 设置页新增「图像 → 图像生成模型」选择器（按 `outputModalities` 含 image 过滤）；「添加模型」表单支持标注输出类型（图片/视频），手填生图模型（决策 1）可进入选择器。
  - bundled SKILL `image-generation`：agent 通过 `execute_command` 调用（必须显式传 `timeoutMs`，如 300000）；生成完成后必须用 `send_attachment` 把图发给用户（桌面附加到回复、频道直接发送）。
  - 超时调用方化：CLI 响应等待不再有 120s 系统默认——`--timeout` 显式设置并同时透传后端生成总超时；未传时阻塞等待，由外层调用者（`execute_command timeoutMs` / Ctrl-C）兜底。
  - 断连传播为 AbortSignal：CLI 超时自杀 / Ctrl-C / 进程被杀时，控制面仅在「请求执行中、响应尚未写回」时取消执行，停止后端轮询，避免额度白扣；`image recognize` 迁移到同一超时规则。

### Patch Changes

- Updated dependencies [c631d22]
- Updated dependencies [ff50775]
- Updated dependencies [96dd8d0]
- Updated dependencies [a54dcf3]
- Updated dependencies [0e68fc2]
- Updated dependencies [377ba35]
  - @ant-chat/shared@1.0.0-alpha.6

## 1.0.0-alpha.3

### Minor Changes

- 80f4283: 纯文本模型图片附件的图像识别闭环

  - 目标模型不支持图片输入时，运行时把图片附件替换为 `file_id` 汇总占位符，并引导 agent 调用识别命令逐张识别。
  - 新增 CLI 命令 `ant-chat image recognize`（`--path` / `--file-id` / `--prompt` / `--provider-id` / `--model-id` / `--json`）：工作区图片按绝对路径读取，聊天附件按 `file_id` 走应用内附件存储；图片校验 png/jpg/jpeg/webp/gif 且 ≤10MB，识别模型默认取设置页配置的视觉模型。
  - 设置页新增「视觉模型 → 图像识别模型」配置（仅列出支持图片输入的模型）。
  - bundled SKILL `image-recognition`：agent 通过 `execute_command` 主动调用；调用需显式传 `timeoutMs: 150000`（视觉识别是同步模型调用，默认 10 秒超时不够）。
  - 开发环境 `ant-chat` launcher 改为纯 CLI（node + tsx），不依赖 pnpm 与调用方 cwd；CLI 连接实际运行中的 Runtime（残留端点提示 + dev/prod 默认根回退）。

### Patch Changes

- Updated dependencies [e2ce6cd]
- Updated dependencies [80f4283]
- Updated dependencies [831d10e]
  - @ant-chat/shared@1.0.0-alpha.4

## 1.0.0-alpha.2

### Minor Changes

- 893be45: 新增 AI Native 应用控制契约与 `ant-chat` CLI，支持设置、服务商、MCP 和自动化管理。

### Patch Changes

- d0e2eb6: 为 MCP server 增加启用/禁用开关：禁用后不再随应用启动自动连接并立即停止；MCP 配置页回填真实连接状态，不再误显示为已停止。
  MCP 配置页改为左右分栏：左侧服务器列表、右侧展示选中服务器的工具列表，并移除 MCP server 的 icon 字段。
  修复 MCP OAuth server 认证失效后无法重新授权的问题：McpModule 现在会把回调地址注入连接管理器，
  401 或 refresh token 失效时自动清除旧凭据并重新发起浏览器授权，而不是直接报 Unauthorized。
  应用启动的自动连接不再弹交互式 OAuth 授权窗口：需要重新授权时保持未运行，
  由用户在 MCP 设置页点击启动按钮时再发起授权。
- Updated dependencies [77a5e4c]
- Updated dependencies [ac16c9b]
- Updated dependencies [893be45]
- Updated dependencies [6135228]
- Updated dependencies [90afafd]
- Updated dependencies [c8b903c]
- Updated dependencies [d0e2eb6]
- Updated dependencies [3e473c0]
- Updated dependencies [a5511b3]
- Updated dependencies [0ffdbf0]
- Updated dependencies [914c4ae]
  - @ant-chat/shared@1.0.0-alpha.2
