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
- 自动化权限拒绝被当成普通工具错误返回模型，模型随后正常回复会把运行误标为成功。

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
- Browser 普通网页操作属于 `external`；复用系统 Chrome Profile 属于 `outside`。

### 3. Tool Authorization 拥有唯一策略裁决

- `blocked` 在任何交互模式下都不能被覆盖；`full_managed` 只跳过人工审批。
- 交互 Turn 的 `outside` 和 `external` 都进入审批；持久 deny 规则优先阻止，allow
  规则只能满足 `require_approval`，各工具的匹配粒度由 ADR-0001 定义。
- 自动化策略是穷举的，不回退到交互审批：
  - MCP 工具需要 `allowMcpTools`，并且只注入用户选中的服务。
  - Browser 需要 `allowBrowser`；系统 Chrome Profile 始终拒绝。
  - 文件、平台中立命令和 Skill 继续使用各自已有的显式权限。

### 4. Agent Loop 和 Automation Runtime 拥有各自终态

- 交互 Turn 可把普通权限拒绝作为工具结果交还模型解释。
- 自动化遇到策略阻断时必须终止 Loop，不能继续生成成功回复；用户配置的 deny 规则是例外，它只阻止当前工具调用并将原因交回模型。
- `AutomationRuntime` 将该终态收口为 `needs_attention`。
- Secret 请求携带 `automationRunId`，即使事件早于 `startTurn` 返回，也能可靠转为
  `needs_attention`。
- Secret 请求绑定 Turn 的 `AbortSignal`；转人工后取消任务会立即清理 pending 请求，
  不等待超时。

## 安全默认值

- MCP 工具不依据远端 `readOnlyHint` 自动扩大权限。
- 自动化 Browser 默认关闭。
- 自动化不允许复用系统 Chrome Profile。
- 未知操作类型、无策略、`blocked` 和未覆盖能力均拒绝。
- 记忆授权不能覆盖系统拒绝或自动化策略。

## 验证门槛

- 自动化关闭 MCP 能力时不注入任何 MCP 工具；开启后也只注入所选服务。
- Browser 关闭时不进入自动化工具集合；开启后普通网页操作可执行。
- 系统 Chrome Profile 在交互模式进入审批，在自动化中始终拒绝。
- `full_managed` 不能覆盖 `blocked`。
- 自动化策略拒绝不会被后续模型回复改写为成功。
- 早到的 Secret 请求不会因 taskId 映射尚未建立而丢失。
- 自动化转人工取消任务后不残留等待中的 Secret Promise。
