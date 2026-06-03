# 任务与工具耗时记录方案

## Summary

现状：消息列表标题来自 [MessageBubble.tsx](/Users/ysansan/webProject/ant-chat/apps/web/src/components/Chat/MessageBubble.tsx:143) 的 `execution process (${processMessages.length})`。任务总耗时已在 loop 的 `task_completed` 日志 payload 中计算，见 [agentLoop.ts](/Users/ysansan/webProject/ant-chat/packages/agent-core/src/loop/agentLoop.ts:289)，但没有进入 assistant message。工具日志已有部分 `durationMs`，但由 tool result 提供，参数错误、策略阻断、取消路径覆盖不完整，见 [toolExecution.ts](/Users/ysansan/webProject/ant-chat/packages/agent-core/src/tools/toolExecution.ts:51)。

目标：把每个任务的整体耗时持久化到 assistant message，用它替换消息列表中的 `execution process(xx)`；每个工具的耗时只写入结构化 JSONL 日志，不进入 UI 消息内容。

## Key Changes

- 在 shared message schema 和接口中给 assistant message 增加可选 `durationMs?: number`，包括 `AIMessage`、`IMessageAI`、通用 `IMessage`、`UpdateMessageSchema`。
- 在 SQLite `messages` 表新增 `duration_ms integer DEFAULT NULL`，更新 `MESSAGE_COLUMNS`、create/update/map row 逻辑，并在 app-data 初始化时补一个幂等迁移，已有本地库缺列时执行 `ALTER TABLE messages ADD COLUMN duration_ms integer DEFAULT NULL`。
- 扩展 `IAgentEventEmitter.emitTurnFinished` 参数为 `{ conversationId, text, status, durationMs }`，由 `runAgentLoop` 在成功、失败、取消路径传入同一个任务级耗时。
- 在 `SessionRuntime` 的 store-backed emitter 中，把 `emitTurnFinished.durationMs` 写入最终 assistant message；流式中间态不写 duration，最终态才持久化。
- 在 `MessageBubble` 中把折叠标题从 `execution process(n)` 改为任务耗时显示。默认格式：小于 1 秒显示 `0.8s`，小于 60 秒显示 `12.3s`，60 秒及以上显示 `1m 05s`。缺少 `durationMs` 的历史消息使用 `execution process(n)` 兼容展示。
- 在 `executeToolStep` 内统一用 `Date.now()` 计时，给 `tool_completed`、`tool_failed`、`tool_blocked`、`tool_cancelled` 写入 `durationMs`。保留原始 tool result 的 stdout、stderr、exitCode、outputPreview；如 tool result 自带 `durationMs`，可额外写 `toolReportedDurationMs`，避免混淆整体耗时。
- `createInvalidToolArgsResult` 只处理模型返回的非法参数，它没有 task trace context；保持现有 UI 结果行为，不写工具耗时日志。loop 层的 invalid args path 如需结构化耗时，后续单独把 task context 传入该函数。

## Test Plan

- `packages/agent-core/src/loop/__tests__/agentLoop.spec.ts`：断言成功、失败、取消时 `emitTurnFinished` 带具体 `durationMs`，并继续断言 `task_completed` / `task_failed` JSONL payload。
- `packages/agent-core/src/tools/__tests__/toolExecution.spec.ts`：断言 `tool_completed`、执行失败、validation failed、policy blocked、cancelled 的 `taskLogger.write` payload 都有 `durationMs: expect.any(Number)`。
- `packages/agent-core` 的 session runtime 相关测试或新增测试：验证 `emitTurnFinished({ durationMs })` 最终调用 `updateAssistantMessage`，并把 `durationMs` 持久化到 assistant message。
- `packages/app-data` repository 和 migration 测试：验证新建、更新、读取 assistant message 能保留 `durationMs`；旧 schema 缺 `duration_ms` 时初始化后能读取。
- Web 组件测试：验证有 `durationMs` 时折叠标题显示耗时，历史消息没有 `durationMs` 时仍显示原 `execution process(n)`。
- 验证命令：先跑目标测试，再跑 `pnpm type-check`、`pnpm lint`、`pnpm test:unit`。按项目规则不运行 dev/build/start/serve。

## Assumptions

- 任务总耗时定义为 `runAgentLoop` 从开始到成功、失败或取消终态的 wall-clock 时间，包含模型请求、工具执行、等待 approval 和 compaction hook。
- UI 只展示最终 assistant message 的任务总耗时，不展示单个工具耗时。
- 工具耗时定义为 `executeToolStep` 从接收到单个 tool call 到该 tool call 终态的 wall-clock 时间，覆盖 prepare、policy 和 execute 阶段。
- 历史消息没有 `durationMs` 时保持现有文案，避免迁移时伪造旧任务耗时。
