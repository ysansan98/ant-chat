---
"@ant-chat/backend": minor
"@ant-chat/shared": minor
"ant-chat": minor
---

新增外部可扩展的 hooks 机制（P0–P1，共 11 个事件）：

- 运行时内核：两层配置（`~/.ant-chat/hooks.json` + `<workspace>/.agents/hooks.json`）、command handler 执行、stdin JSON 协议、超时与失败隔离、deny/ask 聚合；`developerTools.agentHooksEnabled` 总开关（默认开启）。
- P0 事件：`SessionStart`、`SessionEnd`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`。
- P1 事件：`PermissionRequest`、`PreCompact`、`PostCompact`、`Interrupt`、`Notification`。
- 安全顺序：policy 先行，hook 只收紧；`PreToolUse` 的 `deny` 直接阻断，`ask` 复用现有审批流（automation 降级为阻断）。
- 配置损坏按"无 hook"处理并隔离损坏文件；hook 超时/崩溃/解析失败不阻塞主流程。
