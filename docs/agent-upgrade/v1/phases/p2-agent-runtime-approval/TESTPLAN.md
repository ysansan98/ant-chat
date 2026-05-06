# P2 测试计划：Agent Runtime 与审批

## 测试目标

- 验证简单聊天仍走原 `chat.sendChatCompletions` 链路。
- 验证复杂任务进入 Agent Runtime，并正确驱动进度、审批、取消和最终消息。
- 验证 Policy Engine 对 strict/hybrid/full_managed 的风险决策一致。
- 验证所有工具执行都受 Main 进程策略控制，审批不能绕过工作区边界和硬阻断。
- 验证 Runtime 状态不污染数据库持久化模型。
- 验证未完成 task 写入临时 checkpoint，重启后可恢复，结束后删除 checkpoint。
- 验证每个 task 都产生完整结构化日志，且日志不泄露敏感内容。

## 建议命令

- `pnpm type-check`
- `pnpm lint`
- `pnpm test:unit`

## 自动化覆盖要求

### Main 单元测试

新增或覆盖以下测试文件：

- `src/main/agent/policy/__tests__/policyEngine.spec.ts`
- `src/main/agent/runtime/__tests__/taskStore.spec.ts`
- `src/main/agent/runtime/__tests__/approvalGate.spec.ts`
- `src/main/agent/runtime/__tests__/budgetTracker.spec.ts`
- `src/main/agent/runtime/__tests__/checkpointStore.spec.ts`
- `src/main/agent/runtime/__tests__/agentLogger.spec.ts`
- `src/main/agent/runtime/__tests__/agentRuntime.spec.ts`
- `src/main/domains/agent/__tests__/ipc.spec.ts`

重点使用 fake model runner 和 fake tool registry，避免测试依赖真实模型或真实文件系统副作用。Native tool 的路径和 bash 约束继续由 P1 的 `nativeToolService.spec.ts` 覆盖，P2 只验证 Runtime 是否正确调用和处理返回值。

### Renderer 单元测试

新增或覆盖以下测试文件：

- `src/renderer/src/store/agent/__tests__/actions.spec.ts`
- `src/renderer/src/components/Agent/__tests__/AgentProgressList.spec.tsx`
- `src/renderer/src/components/Agent/__tests__/AgentApprovalCard.spec.tsx`
- `src/renderer/src/components/Chat/__tests__/agentRouting.spec.tsx`
- `src/renderer/src/components/Chat/__tests__/agentRecovery.spec.tsx`

Renderer 测试只验证状态和 UI，不 mock Main 内部 Runtime 细节。

### 集成测试

使用 fake IPC 或 test harness 验证：

- `Chat.onSubmit()` 的简单/复杂任务分流。
- `agent:*` 事件进入 agent store 后，进度列表和审批卡片按 conversation 过滤。
- approve/reject/cancel 操作调用 `agentApi`，并处理错误响应。

## 风险矩阵测试

### TC-P2-Policy-1：strict 模式全部需要审批

- 对应验收：AC-P2-11
- 前置：构造 L0、L1、L2 三类工具 action。
- 步骤：调用 `PolicyEngine.decide()`，mode 为 `strict`。
- 期望：三类 action 都返回 `require_approval`。

### TC-P2-Policy-2：hybrid 模式 L0 自动执行

- 对应验收：AC-P2-7
- 前置：构造 `read_file` 或 `grep_files` action。
- 步骤：调用 `PolicyEngine.decide()`，mode 为 `hybrid`。
- 期望：返回 `allow`，不创建 pending action。

### TC-P2-Policy-3：hybrid 模式 L1/L2 需要审批

- 对应验收：AC-P2-8
- 前置：构造 `write_file`、`apply_patch` 或高风险 `bash` action。
- 步骤：调用 `PolicyEngine.decide()`，mode 为 `hybrid`。
- 期望：返回 `require_approval`，pending action 包含 `actionId`、`toolName`、`riskLevel` 和 `inputPreview`。

### TC-P2-Policy-4：full_managed 自动执行可允许动作

- 对应验收：AC-P2-10
- 前置：构造 L0、L1、L2 且未触发硬阻断的 action。
- 步骤：调用 `PolicyEngine.decide()`，mode 为 `full_managed`。
- 期望：返回 `allow`。

### TC-P2-Policy-5：硬阻断不可审批绕过

- 对应验收：AC-P2-10
- 前置：构造工作区越界、symlink 逃逸或危险 bash action。
- 步骤：调用 `PolicyEngine.decide()`。
- 期望：返回 `block` 和 `AGENT_POLICY_BLOCKED`；不发送 `agent:approval-required`。

## Runtime 状态机测试

### TC-P2-Runtime-1：复杂任务创建 task

- 对应验收：AC-P2-2
- 步骤：调用 `startTask()`，传入有效 conversation、userMessage 和 prompt。
- 期望：返回 `taskId`，task 状态为 `running`，保存创建时 `workspacePath`。

### TC-P2-Runtime-2：plan/act/observe 最小循环成功结束

- 对应验收：AC-P2-2、AC-P2-3、AC-P2-4
- 前置：fake model 依次返回计划、L0 工具调用、最终回答。
- 步骤：启动 task。
- 期望：按顺序发送 `agent:progress-updated`，最终发送 `agent:state-updated(success)`，assistant message 更新为 `success`。

### TC-P2-Runtime-3：hybrid 下 L0 工具自动执行

- 对应验收：AC-P2-7
- 前置：fake tool risk 为 L0。
- 步骤：启动 hybrid task。
- 期望：tool registry 被调用一次，不产生 pending action，不发送审批事件。

### TC-P2-Runtime-4：hybrid 下 L1 工具暂停等待审批

- 对应验收：AC-P2-8
- 前置：fake tool risk 为 L1。
- 步骤：启动 hybrid task。
- 期望：状态变为 `awaiting_approval`，发送 `agent:approval-required`，工具未执行。

### TC-P2-Runtime-5：审批通过后恢复执行

- 对应验收：AC-P2-8、AC-P2-12
- 前置：task 处于 `awaiting_approval`，记录当前 `actionId`。
- 步骤：调用 `approvePendingAction(taskId, actionId)`。
- 期望：状态回到 `running`，工具执行一次，pending action 被清空，loop 继续。

### TC-P2-Runtime-6：审批拒绝后动作不执行

- 对应验收：AC-P2-9、AC-P2-12
- 前置：task 处于 `awaiting_approval`。
- 步骤：调用 `rejectPendingAction(taskId, actionId, 'reason')`。
- 期望：工具未执行，拒绝原因作为 observation 返回 Runtime，pending action 被清空。

### TC-P2-Runtime-7：重复 approve 不重复执行工具

- 对应验收：AC-P2-12
- 前置：task 处于 `awaiting_approval`。
- 步骤：连续两次调用 `approvePendingAction(taskId, actionId)`。
- 期望：第一次恢复执行，第二次返回幂等完成或 `AGENT_TASK_NOT_APPROVABLE`，工具总调用次数为 1。

### TC-P2-Runtime-8：错误 actionId 不放行

- 对应验收：AC-P2-12
- 前置：task 处于 `awaiting_approval`。
- 步骤：调用 `approvePendingAction(taskId, 'stale-action-id')`。
- 期望：返回 `AGENT_APPROVAL_ACTION_MISMATCH`，工具未执行，task 仍等待原 action。

### TC-P2-Runtime-9：审批超时失败

- 对应验收：AC-P2-6、AC-P2-8
- 前置：pending action 设置很短 timeout。
- 步骤：等待 timeout。
- 期望：task 变为 `failed`，errorCode 为 `AGENT_APPROVAL_TIMEOUT`，工具未执行。

### TC-P2-Runtime-10：取消 running task

- 对应验收：AC-P2-5
- 步骤：启动长任务后调用 `cancelTask(taskId)`。
- 期望：模型流被 abort，状态为 `cancelled`，不再发送新的 progress，assistant message 状态为 `cancel`。

### TC-P2-Runtime-11：取消 awaiting_approval task

- 对应验收：AC-P2-5
- 前置：task 处于 `awaiting_approval`。
- 步骤：调用 `cancelTask(taskId)`。
- 期望：pending action 被清空，状态为 `cancelled`，后续 approve/reject 返回 `AGENT_TASK_NOT_APPROVABLE`。

### TC-P2-Runtime-12：预算 maxSteps 超限

- 对应验收：AC-P2-6
- 前置：budget 设置 `maxSteps: 1`，fake model 需要多轮。
- 步骤：启动 task。
- 期望：task 停止，errorCode 为 `AGENT_BUDGET_EXCEEDED`，assistant message 包含预算超限说明。

### TC-P2-Runtime-13：预算 maxDurationMs 超限

- 对应验收：AC-P2-6
- 前置：fake model 或 fake tool 延迟超过预算。
- 步骤：启动 task。
- 期望：task 停止，后续 action 不执行。

### TC-P2-Runtime-14：工具失败进入 failed 或可观察恢复

- 对应验收：AC-P2-6、AC-P2-10
- 前置：fake tool 返回 `{ ok: false, error: 'AGENT_TOOL_EXEC_FAILED' }`。
- 步骤：启动 task。
- 期望：Runtime 将失败作为 observation；模型无替代方案时 task 变为 `failed`，最终 message 有错误摘要。

### TC-P2-Runtime-15：同一 conversation 禁止并发 active task

- 对应验收：AC-P2-13
- 步骤：对同一 conversation 连续调用两次 `startTask()`。
- 期望：第一次成功，第二次返回 `AGENT_TASK_ALREADY_RUNNING`，不创建第二个 active task。

### TC-P2-Runtime-16：task 使用创建时 workspacePath

- 对应验收：AC-P2-14
- 步骤：启动 task 后切换当前工作区，再让 task 执行工具。
- 期望：工具使用 task snapshot 中的 `workspacePath`，不使用切换后的全局 workspace。

### TC-P2-Runtime-17：不持久化进度和审批历史

- 对应验收：AC-P2-15
- 步骤：运行包含审批和多步进度的复杂 task。
- 期望：数据库中只出现 user message 和最多一条 assistant message；没有新增 agent 表；message 中不包含 progress、approval、tool history。

### TC-P2-Runtime-18：状态变化写入 checkpoint

- 对应验收：AC-P2-16
- 步骤：启动 task，并触发 progress 更新、pending action 创建、pending action 清空、预算计数变化。
- 期望：每次变化后 checkpoint 文件被原子更新，内容包含最新 task snapshot、budgetUsage 和 loopState。

### TC-P2-Runtime-19：重启后恢复 awaiting_approval task

- 对应验收：AC-P2-16
- 前置：checkpoint 中 task 状态为 `awaiting_approval`。
- 步骤：重新初始化 Agent Runtime。
- 期望：task 恢复为 `awaiting_approval`，重新发送 `agent:approval-required`，原 `actionId` 不变。

### TC-P2-Runtime-20：重启后从 observation 边界继续

- 对应验收：AC-P2-16
- 前置：checkpoint 中存在已完成 observation，同时 task 中断在模型或工具调用中间态。
- 步骤：重新初始化 Agent Runtime。
- 期望：Runtime 从最近完成 observation 继续，不重复已确认完成的工具结果，日志记录 `task_recovered_after_interrupt`。

### TC-P2-Runtime-21：task 结束后删除 checkpoint

- 对应验收：AC-P2-16
- 步骤：分别让 task 进入 `success`、`failed`、`cancelled`。
- 期望：对应 checkpoint 文件被删除；删除失败只写日志，不改变 task 最终状态。

### TC-P2-Runtime-22：损坏 checkpoint 可解释失败

- 对应验收：AC-P2-16
- 前置：写入无法解析的 checkpoint 文件。
- 步骤：初始化 Agent Runtime。
- 期望：损坏文件移动到 `agent/tasks/corrupt/`，task 标记为 `failed`，日志记录 `checkpoint_corrupt`。

### TC-P2-Runtime-23：完整结构化日志

- 对应验收：AC-P2-17
- 步骤：运行一个包含模型请求、L0 工具、L1 审批、预算更新和成功结束的 task。
- 期望：生成 `agent/logs/<yyyy-mm-dd>/<taskId>.jsonl`，包含 `task_started`、`model_request_started`、`tool_decision`、`approval_required`、`approval_approved`、`tool_completed`、`budget_updated`、`task_completed`。

### TC-P2-Runtime-24：日志脱敏和截断

- 对应验收：AC-P2-17
- 前置：tool input/output 中包含超长文本、疑似 API Key、环境变量字段。
- 步骤：写入日志。
- 期望：日志字段被截断，敏感字段被遮蔽，不出现完整 API Key 或完整环境变量。

## IPC 测试

### TC-P2-IPC-1：startTask 入参校验

- 对应验收：AC-P2-2
- 步骤：分别缺省 `conversationId`、`userMessageId`、`prompt` 调用 `startTask()`。
- 期望：返回失败响应，不创建 task。

### TC-P2-IPC-2：未知 task 返回 AGENT_TASK_NOT_FOUND

- 对应验收：AC-P2-5、AC-P2-8
- 步骤：对不存在的 `taskId` 调用 approve/reject/cancel/getTask。
- 期望：返回 `AGENT_TASK_NOT_FOUND`。

### TC-P2-IPC-3：listActiveTasks 返回可恢复 task

- 对应验收：AC-P2-16
- 步骤：创建多个 task，分别覆盖 running、awaiting_approval、success、failed、cancelled 状态后调用 `listActiveTasks(conversationId?)`。
- 期望：只返回 running 和 awaiting_approval；传入 conversationId 时只返回对应会话的 active task。

### TC-P2-IPC-4：非审批状态 reject 返回不可审批

- 对应验收：AC-P2-12
- 步骤：对 running/success/failed/cancelled task 调用 reject。
- 期望：返回 `AGENT_TASK_NOT_APPROVABLE`。

### TC-P2-IPC-5：事件 payload 强类型完整

- 对应验收：AC-P2-3、AC-P2-8、AC-P2-16
- 步骤：触发 state/progress/approval/task-recovered 四类事件。
- 期望：payload 包含 README 定义字段，TypeScript 编译通过，无 `any` 绕过。

## Renderer 测试

### TC-P2-UI-1：简单问题不显示进度 UI

- 对应验收：AC-P2-1
- 步骤：输入一个简单事实问题，例如“今天是星期几”。
- 期望：调用普通聊天 API，不调用 `startTask`，输入框上方不出现 Agent 进度列表。

### TC-P2-UI-2：复杂任务触发 Agent task

- 对应验收：AC-P2-2
- 步骤：输入“检查当前项目并总结需要修改的地方”。
- 期望：调用 `agent.startTask`，不调用 `chat.sendChatCompletions`。

### TC-P2-UI-3：复杂任务显示进度列表

- 对应验收：AC-P2-3
- 步骤：向 store 派发 `agent:progress-updated`。
- 期望：输入框上方出现轻量进度列表。

### TC-P2-UI-4：进度状态完整

- 对应验收：AC-P2-4
- 步骤：注入 `done`、`running`、`pending`、`failed`、`skipped` 状态。
- 期望：每种状态都有明确文案和视觉区分。

### TC-P2-UI-5：取消运行中 task

- 对应验收：AC-P2-5
- 步骤：存在 active task 时点击取消。
- 期望：调用 `agent.cancelTask(taskId)`，而不是 `chat.cancelChatCompletions()`。

### TC-P2-UI-6：普通聊天取消不调用 Agent

- 对应验收：AC-P2-1、AC-P2-5
- 步骤：普通聊天流式输出中点击取消。
- 期望：调用 `chat.cancelChatCompletions(conversationId)`，不调用 `agent.cancelTask()`。

### TC-P2-UI-7：审批卡片展示完整信息

- 对应验收：AC-P2-8
- 步骤：派发 `agent:approval-required`。
- 期望：卡片展示风险等级、工具名、说明、输入预览、批准和拒绝按钮。

### TC-P2-UI-8：审批按钮绑定 actionId

- 对应验收：AC-P2-12
- 步骤：点击批准和拒绝。
- 期望：调用参数包含 `taskId` 和当前 `actionId`。

### TC-P2-UI-9：切换会话过滤 task UI

- 对应验收：AC-P2-3、AC-P2-14
- 步骤：store 中存在两个 conversation 的 task。
- 期望：当前会话只展示自己的进度和审批卡片。

### TC-P2-UI-10：task 完成后清理 UI

- 对应验收：AC-P2-3
- 步骤：派发 `agent:state-updated(success)`。
- 期望：进度列表短暂显示完成状态后移除，approval 卡片不存在。

### TC-P2-UI-11：刷新后恢复 Agent UI

- 对应验收：AC-P2-16
- 前置：Main 中存在 recovered active task。
- 步骤：重新挂载 Chat 页面，调用 `listActiveTasks(conversationId)` 或接收 `agent:task-recovered`。
- 期望：输入框上方恢复对应进度列表；如果 task 等待审批，恢复审批卡片和原 `actionId`。

## 端到端手测用例

### TC-P2-E2E-1：简单聊天回归

- 对应验收：AC-P2-1
- 步骤：启动应用，选择模型，输入简单事实问题。
- 期望：聊天正常流式输出，无 Agent 进度或审批 UI。

### TC-P2-E2E-2：复杂只读任务

- 对应验收：AC-P2-2、AC-P2-3、AC-P2-4、AC-P2-7
- 步骤：hybrid 下输入“检查当前项目结构并总结主要模块”。
- 期望：进入 Agent task，执行只读工具无需审批，展示进度，最终写入 assistant message。

### TC-P2-E2E-3：复杂写入任务审批通过

- 对应验收：AC-P2-8
- 步骤：hybrid 下要求“新建一个 TODO.md，写入当前项目待办”。
- 期望：出现审批卡片；点击批准后文件创建，task 继续并成功结束。

### TC-P2-E2E-4：复杂写入任务审批拒绝

- 对应验收：AC-P2-9
- 步骤：hybrid 下要求修改文件，审批时点击拒绝。
- 期望：文件不变，task 给出拒绝后的摘要或替代建议。

### TC-P2-E2E-5：预算超限

- 对应验收：AC-P2-6
- 步骤：将 `maxSteps` 或 `maxDurationMs` 设置很小后触发复杂任务。
- 期望：task 停止，UI 和最终 assistant message 都显示预算超限。

### TC-P2-E2E-6：full_managed 与硬阻断

- 对应验收：AC-P2-10
- 步骤：full_managed 下分别触发工作区内安全修改和工作区外写入。
- 期望：安全修改自动推进；工作区外写入被阻断且不出现审批绕过入口。

### TC-P2-E2E-7：strict 模式审批

- 对应验收：AC-P2-11
- 步骤：strict 下触发只读项目检查。
- 期望：即使是 L0 工具也要求审批。

### TC-P2-E2E-8：同会话并发保护

- 对应验收：AC-P2-13
- 步骤：复杂 task 运行中再次提交复杂任务。
- 期望：不会启动第二个 active task，UI 给出明确提示。

### TC-P2-E2E-9：工作区切换隔离

- 对应验收：AC-P2-14
- 步骤：在工作区 A 启动长任务，切到工作区 B，再批准 A 的 pending action。
- 期望：A 的 task 仍操作工作区 A，不操作工作区 B。

### TC-P2-E2E-10：刷新窗口后的 UI 恢复

- 对应验收：AC-P2-16
- 步骤：task 运行中刷新 Renderer。
- 期望：UI 从 Main active task 恢复进度；如果处于审批态，审批卡片恢复且 actionId 不变。

### TC-P2-E2E-11：应用重启后继续未完成 task

- 对应验收：AC-P2-16
- 步骤：复杂 task 进入等待审批或完成至少一个 observation 后重启应用。
- 期望：Runtime 从 checkpoint 恢复 task；等待审批的 task 继续等待审批；中断在模型或工具中间态的 task 从最近安全边界继续。

### TC-P2-E2E-12：task 完成后 checkpoint 清理

- 对应验收：AC-P2-16
- 步骤：分别完成、取消、制造失败一个 Agent task。
- 期望：对应 `agent/tasks/<taskId>.json` 被删除；数据库没有 agent 进度、审批、工具历史。

### TC-P2-E2E-13：运行日志可追踪完整生命周期

- 对应验收：AC-P2-17
- 步骤：运行一个包含审批、工具执行和最终成功的 task。
- 期望：生成 task jsonl 日志，能串起从 `task_started` 到 `task_completed` 的完整事件，且日志不包含明文密钥或完整大段文件内容。
