---
"ant-chat": minor
"@ant-chat/desktop": patch
---

自动化运行状态改为执行事实与收件箱查看态，不再判定成败：

- `AutomationRunStatus` 收缩为 `queued / running / completed / skipped / cancelled / awaiting`，移除 `succeeded / failed` 成败判定（无人值守下无法可靠判定，模型总结不可信）；审批与 Secret 请求收口为 `awaiting`（等待你操作）。
- 自动化权限拒绝不再中断 Loop：拒绝结果交回模型继续，可换写法重试或继续其他步骤；run 终态统一 `completed`，异常/拒绝信息保留在 `errorCode / errorMessage`。
- 新增查看态 `readAt`（收件箱语义：completed 且未打开 = 未读），新增 `automation.markRunRead` 已读接口；自动化页面移除概览统计卡，运行记录列表显示未读标记与「等待你操作」状态。
- sqlite 迁移 v11：`automation_runs` 增加 `read_at` 列，存量 `succeeded / failed → completed`、`needs_attention → awaiting`。
- 打包应用解析 login shell PATH 合入命令环境（仅提取 PATH），修复打包后 `execute_command` 找不到 node 等用户工具的问题。
