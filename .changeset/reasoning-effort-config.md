---
"@ant-chat/shared": minor
"@ant-chat/backend": minor
"@ant-chat/web": minor
---

支持在对话设置中配置「推理强度（reasoning effort）」，端到端打通：

- models.dev 同步 `reasoning_options` 能力，导入时归一化为 ai-sdk v7 档位（`max`→`xhigh`，丢弃未知档位），落库模型能力 `reasoningLevels`。
- 共享层新增 `ReasoningEffortSchema` / `ReasoningEffortLevel` 类型与 `mapModelsDevEffortToV7` 映射函数；`ConversationsSettingsSchema`、`ModelSettings`、`IAIProvider.streamModel` 等接口增加 `reasoningEffort`。
- 后端沿 `agentTurnService` → `SessionRuntime` → `agentLoop` → `MultiProvider` 透传，最终通过 ai-sdk v7 统一 `reasoning` 参数下发（仅设值时传）。
- 前端「模型参数」面板在模型具备 `reasoningLevels` 时渲染推理强度下拉，并同步到对话设置。
