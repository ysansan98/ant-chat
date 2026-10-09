---
'ant-chat': minor
'@ant-chat/backend': minor
'@ant-chat/shared': minor
'@ant-chat/web': minor
'@ant-chat/desktop': patch
---

内置服务商 Magpie（本机 magpie 网关）

- 新增内置服务商 **Magpie**：把本机 magpie 网关（默认 `http://127.0.0.1:3425/v1`）作为 OpenAI 兼容服务商接入。地址可配置（magpie 的 `MAGPIE_ADDR`/`settings.json` 可改端口），默认关闭，老配置启动时自动补上该预置 Provider。
- 模型目录实时来自 `GET /v1/models`：映射 `context_window`/`max_output_tokens`、`supported_reasoning_levels`（复用 models.dev 档位映射）、`modalities.input`；用户在 magpie 里增删供应商后重新「同步模型」即可看到。
- 新增 `provider.probeIntegrations` RPC 与设置页接入体验：`GET /api/hello` 检测本机 magpie 是否在运行并显示版本，检测到后提供「启用并同步模型」一键接入（写入探测到的地址、启用条目、同步模型）。
- 未配置密钥时以 `magpie-ant-chat` 作为 Bearer key，用量在 magpie 里记为 ant-chat；网关联不上、返回 401 等给出的都是可读中文错误。
- magpie 图标内置为打包资源（`apps/web/src/assets/icons/magpie.svg`），不再依赖 models.dev 远程目录；其他服务商取图逻辑不变。
