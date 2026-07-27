# Ant Chat

Ant Chat 管理用户对话、Agent 执行及其运行诊断。

## Language

**Model Request（模型请求）**:
Agent Runtime 在 `agent-core → AI provider` seam 上实际提交给模型的一次完整请求；以传入 provider 的原始对象为准，不包含 provider adapter 后续生成的厂商 HTTP payload。
_Avoid_: 上下文投影、请求预览、HTTP 请求

**Context Diagnostics（上下文诊断）**:
按时间展示 `Model Request` 输入及其变化的开发期诊断能力；中间模型输出通过后续请求中的上下文体现，不负责记录模型响应或请求终态。
_Avoid_: 响应日志、任务追踪、模型调用日志

**Execution Trace（执行轨迹）**:
面向 Agent 开发者的可观测性视图，按时间关联一个 Conversation 中的 Agent Turn、Model Request、Policy Decision、Tool Call 与 Context Event，并允许从 Turn 下钻到原始证据。
_Avoid_: 消息列表、运行日志、指标面板

**Agent Turn**:
一次交互或 Automation 触发的完整 Agent 执行，是一条 Execution Trace 的根；同一 Conversation 可以包含多个 Agent Turn。
_Avoid_: Message、Model Request、Task 日志文件

**Trace Span**:
Agent Turn 内具有开始、结束和状态的 typed 执行步骤；Model Request、Policy Decision 与 Tool Call 都以 Span 表达，并通过父子关系呈现顺序或并行。
_Avoid_: 任意日志事件、UI 时间块

**Context Event**:
Agent Turn 中改变后续 Model Request 上下文的瞬时事实，例如 compaction、steering 或 history rewrite；它没有持续时间，不作为 Trace Span。
_Avoid_: Context diff、Message、Trace Span

**Agent Observability（Agent 可观测性）**:
记录并查询 Agent 执行事实的开发者能力，是 Execution Trace 等视图的证据源；除 Secret 明文外，证据保持原始且不以摘要或展示投影替代。可观测性失败不得改变 Agent Turn 的行为或结果。
_Avoid_: 消息历史、调试打印、运行状态

**Secret（敏感值）**:
仅在受控执行期间解析的敏感数据；其明文不属于 Agent Observability，可观测证据只保留 SecretRef 或明确的脱敏标记。
_Avoid_: 可观测字段、原始日志字段

**Permission Rule（权限规则）**:
用户在交互审批或“权限”页面显式保存的结构化 allow/deny 能力规则；deny 规则优先阻止当前工具调用，allow 规则只能满足基础策略的 `require_approval`。规则按全局或 canonical 工作区分组，并按带解释器身份的命令、文件系统或 MCP 表达可复用边界。
_Avoid_: 工具白名单、命令白名单、审批豁免
