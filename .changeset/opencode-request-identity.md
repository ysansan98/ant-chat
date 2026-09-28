---
'@ant-chat/backend': patch
'@ant-chat/shared': patch
'@ant-chat/desktop': patch
'ant-chat': patch
---

LLM 请求适配 OpenCode Go 标识要求：

- 所有 Provider 出站请求的 `User-Agent` 统一为 `ant-chat/<version>`（fetch 层覆盖，不再出现 AI SDK 默认标识）；版本由宿主注入：desktop 取 `app.getVersion()`，npm 包取构建期注入版本。
- 发往 `opencode.ai` 的会话内请求新增 `x-opencode-session: <conversationId>` 请求头（主循环、标题生成、自动/手动压缩统一透传，同一对话内稳定）。
- `IAIProvider.streamModel/complete` 新增可选 `conversationId` 字段（向后兼容）；`createCompactionStrategy` 工厂新增可选 `conversationId` 参数。
