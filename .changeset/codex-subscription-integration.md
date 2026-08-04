---
"ant-chat": minor
"@ant-chat/desktop": minor
---

新增 OpenAI Codex 订阅提供商支持：OAuth 订阅登录（含本机 Codex CLI 凭据导入）、固定 endpoint 推理、模型目录自动同步、用量额度查询。引入 Provider Integration 架构，统一 API Key 与订阅型提供商的认证、模型来源、额度与生命周期管理；Provider 配置新增 `integrationId`，RPC 对外返回不含密钥的 `ProviderPublicView`；OAuth 回调服务器改为多 handler 分发，Codex 专用回调端口（1455/1457）惰性启动。
