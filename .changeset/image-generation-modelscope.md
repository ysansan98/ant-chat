---
'ant-chat': minor
'@ant-chat/backend': minor
'@ant-chat/shared': minor
'@ant-chat/control-client': minor
'@ant-chat/desktop': patch
'@ant-chat/web': minor
---

ModelScope 图像生成能力与超时/取消调用方化

- 内置服务商新增 **ModelScope（魔搭）**：固定 `https://api-inference.modelscope.cn/v1` endpoint、API Key 认证；「同步模型」合并 models.dev 的 chat 模型与内置生图清单（`Qwen/Qwen-Image`、`Tongyi-MAI/Z-Image-Turbo`），老配置启动时自动补上该预置 Provider。
- 新增 CLI 命令 `ant-chat image generate --prompt <提示词> [--width --height] [--output <目录>] [--timeout <毫秒>] [--json]`：阻塞等待生成完成，产物落盘到 `--output`（缺省 `./generated`，按 CLI 进程 cwd 解析为绝对路径）并在 `--json` 返回 `files[].path`；模型一律来自设置页「图像生成模型」配置（CLI 不暴露模型参数）。
- Provider 语义升级：`ProviderIntegration` 新增 `mediaGeneration` 能力通道（按 image/video 分类，未声明能力 fail closed）；新增 ModelScope（魔搭）Integration——固定 endpoint + API Key 认证，models.dev chat 模型与内置生图清单合并，异步 submit + 3s 轮询 + 独立下载（同 host 才带凭据）。
- 设置页新增「图像 → 图像生成模型」选择器（按 `outputModalities` 含 image 过滤）；「添加模型」表单支持标注输出类型（图片/视频），手填生图模型（决策 1）可进入选择器。
- bundled SKILL `image-generation`：agent 通过 `execute_command` 调用（必须显式传 `timeoutMs`，如 300000）；生成完成后必须用 `send_attachment` 把图发给用户（桌面附加到回复、频道直接发送）。
- 超时调用方化：CLI 响应等待不再有 120s 系统默认——`--timeout` 显式设置并同时透传后端生成总超时；未传时阻塞等待，由外层调用者（`execute_command timeoutMs` / Ctrl-C）兜底。
- 断连传播为 AbortSignal：CLI 超时自杀 / Ctrl-C / 进程被杀时，控制面仅在「请求执行中、响应尚未写回」时取消执行，停止后端轮询，避免额度白扣；`image recognize` 迁移到同一超时规则。
