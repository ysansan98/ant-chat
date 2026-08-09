# ADR：Agent 工具权限按能力、资源域和运行来源统一裁决

## 状态

已接受，2026-07-21。

交互审批规则的数据结构、匹配和持久化由 [ADR-0001：交互审批采用结构化权限规则与独立存储](./0001-tool-approval-rules.md) 规定。

## 背景

Agent 工具权限原先主要依赖 `operationType + scope`，但两个字段的语义并不稳定：

- MCP 固定使用 `outside`，自动化又先拒绝所有非工作区范围，导致旧的 MCP 权限
  实际不可达；同时客户端无法验证远端工具是否真的只读。
- Browser 把网页访问和系统 Chrome Profile 复用都标成 `workspace`，自动化也没有
  Browser 权限项，却会无条件获得并执行该工具。
- `full_managed` 在检查 `blocked` 之前直接允许，系统硬阻断可能被权限模式覆盖。
- 无人值守下「运行是否成功」无法可靠判定：模型总结不可信，权限拒绝也可能被模型
  总结成成功；run 若用 succeeded/failed 呈现会让用户误以为自动化经过了成败校验。

这些问题的共同根因是能力集合、资源边界、审批模式和无人值守终态没有各自明确的
owner。

## 决策

### 1. Tool Registry 拥有当前 Turn 的能力集合

`ToolRegistry` 根据 `AgentTurnSource` 在 Turn 创建时固定可见工具：

- 交互 Turn 使用当前已连接能力。
- 自动化只注入已选择的 Skills、MCP 服务和显式开启的 Browser。
- 未授权能力不进入模型工具列表，授权层仍保留安全默认拒绝。

### 2. 工具描述自身能力和资源域

- `operationType` 表示行为能力；MCP 统一使用 `mcp`，不把服务端提示升级成安全事实。
- `scope` 表示资源域：`workspace`、本机工作区外 `outside`、远程服务 `external`、
  不可覆盖的 `blocked`。
- MCP `ToolAnnotations` 只用于展示提示，不能决定是否放行工具。
- Browser 普通网页操作属于 `external`；应用托管的浏览器认证状态随 Browser 的 `external` 访问使用；复用系统原始 Chrome Profile 属于 `outside`。

### 3. Tool Authorization 拥有唯一策略裁决

- `blocked` 在任何交互模式下都不能被覆盖；`full_managed` 只跳过人工审批。
- 交互 Turn 的 `outside` 和 `external` 都进入审批；持久 deny 规则优先阻止，allow
  规则只能满足 `require_approval`，各工具的匹配粒度由 ADR-0001 定义。
- 自动化策略是穷举的，不回退到交互审批：
  - MCP 工具需要 `allowMcpTools`，并且只注入用户选中的服务。
  - Browser 需要 `allowBrowser`；开启后默认携带应用托管认证状态，系统原始 Chrome Profile 始终拒绝。
  - 文件、平台中立命令和 Skill 继续使用各自已有的显式权限。

### 4. Agent Loop 和 Automation Runtime 拥有各自终态

- 交互 Turn 可把普通权限拒绝作为工具结果交还模型解释。
- 自动化遇到权限拒绝时不中断 Loop：拒绝结果交回模型继续，模型可换写法重试或
  继续其他步骤；用户配置的 deny 规则只阻止当前工具调用并同样交回模型。
- `AutomationRun` 不做成败判定：task 结束统一收口为 `completed`（拒绝/异常信息
  保留在 errorCode/errorMessage），run 只表达执行事实（queued/running/completed/
  skipped/cancelled）和「等待你操作」（`awaiting`，来自审批与 Secret 请求）。
- run 的查看态独立为 `readAt`（收件箱语义：completed 且未打开 = 未读）。
- Secret 请求携带 `automationRunId`，即使事件早于 `startTurn` 返回，也能可靠转为
  `awaiting`。
- Secret 请求绑定 Turn 的 `AbortSignal`；转人工后取消任务会立即清理 pending 请求，
  不等待超时。

## 安全默认值

- MCP 工具不依据远端 `readOnlyHint` 自动扩大权限。
- 自动化 Browser 默认关闭。
- 应用托管认证状态不改变 Browser 的默认关闭状态；只有已经开启 `allowBrowser` 的自动化才会携带它。
- 自动化不允许复用系统 Chrome Profile。
- 未知操作类型、无策略、`blocked` 和未覆盖能力均拒绝。
- 记忆授权不能覆盖系统拒绝或自动化策略。

## 验证门槛

- 自动化关闭 MCP 能力时不注入任何 MCP 工具；开启后也只注入所选服务。
- Browser 关闭时不进入自动化工具集合；开启后普通网页操作可执行。
- 系统 Chrome Profile 在交互模式进入审批，在自动化中始终拒绝。
- `full_managed` 不能覆盖 `blocked`。
- 自动化策略拒绝不中断 Loop；拒绝事实保留在会话 tool-result，run 不做成败判定。
- 早到的 Secret 请求不会因 taskId 映射尚未建立而丢失。
- 自动化转人工取消任务后不残留等待中的 Secret Promise。
