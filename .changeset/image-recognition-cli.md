---
'ant-chat': minor
'@ant-chat/backend': minor
'@ant-chat/shared': minor
'@ant-chat/control-client': minor
'@ant-chat/desktop': patch
'@ant-chat/web': minor
---

纯文本模型图片附件的图像识别闭环

- 目标模型不支持图片输入时，运行时把图片附件替换为 `file_id` 汇总占位符，并引导 agent 调用识别命令逐张识别。
- 新增 CLI 命令 `ant-chat image recognize`（`--path` / `--file-id` / `--prompt` / `--provider-id` / `--model-id` / `--json`）：工作区图片按绝对路径读取，聊天附件按 `file_id` 走应用内附件存储；图片校验 png/jpg/jpeg/webp/gif 且 ≤10MB，识别模型默认取设置页配置的视觉模型。
- 设置页新增「视觉模型 → 图像识别模型」配置（仅列出支持图片输入的模型）。
- bundled SKILL `image-recognition`：agent 通过 `execute_command` 主动调用；调用需显式传 `timeoutMs: 150000`（视觉识别是同步模型调用，默认 10 秒超时不够）。
- 开发环境 `ant-chat` launcher 改为纯 CLI（node + tsx），不依赖 pnpm 与调用方 cwd；CLI 连接实际运行中的 Runtime（残留端点提示 + dev/prod 默认根回退）。
