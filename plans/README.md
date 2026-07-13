# Implementation Plans

由 `improve` skill 于 2026-07-13 生成。除非依赖关系另有说明，请按下表顺序执行。执行者必须先完整阅读计划，遵守 STOP conditions，并在完成后更新状态。

## Execution order & status

| Plan | Title                                            | Priority | Effort | Depends on | Status |
| ---- | ------------------------------------------------ | -------- | ------ | ---------- | ------ |
| 001  | 收口 Sender 到 agent loop 的 turn 输入与会话配置 | P1       | L      | —          | DONE   |

状态值：`TODO`、`IN PROGRESS`、`DONE`、`BLOCKED（附一行原因）`、`REJECTED（附一行原因）`。

## Dependency notes

- 001 是一个按批次执行的纵向重构。必须遵循计划内顺序：契约测试 → 数据迁移 → MCP 删除 → 引用语义收口 → turn DTO 收口 → prompt 合成。

## Findings considered and rejected

- 新增 Agent Profile：当前没有复用 persona/profile 的真实产品需求，引入 profile 生命周期会扩大范围。
- 把 `compaction` 改为必填会话字段：拒绝。它是可选的自动压缩策略覆盖；缺失时 runtime 使用默认策略，手动 `/compact` 仍独立触发。
- 合并自动压缩与手动 `/compact`：拒绝。两条链路触发语义不同，只复用底层 compaction transaction。
- 删除 MCP runtime：拒绝。本计划只删除无效的 `features.enableMCP` 和 Sender 内 MCP 控制面；已连接 MCP server、设置页和 automation 的 `allowedMcpServers` 继续存在。
