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
用户在交互审批或“权限”页面显式保存的结构化 allow/deny 能力规则；deny 规则优先阻止当前工具调用，allow 规则只能满足基础策略的 `require_approval`。规则按全局或 canonical 工作区分组，并按带解释器身份的命令、文件系统、MCP 或浏览器工具表达可复用边界。
_Avoid_: 工具白名单、命令白名单、审批豁免

## 消息频道领域

**消息频道（Channel）**：把一个外部 IM 平台的私聊消息接入本地 Agent，并把该 Turn 的结果投递回原入口的传输能力。
_Avoid_: 外部用户系统、远程账号系统

**频道账号（Channel Account）**：本机连接到某个平台的一个 Bot 或 iLink 身份，以及该连接的默认工作区和启用状态。
_Avoid_: 本地用户账号、租户

**频道会话（Channel Session）**：一个频道账号与一个外部 1v1 私聊之间的持久路由状态，指向当前本地 Conversation。
_Avoid_: Conversation、频道连接

**频道配对（Channel Pairing）**：电脑所有者批准某个外部消息身份使用本机频道账号的过程；它不创建本地账号。
_Avoid_: 登录、注册、用户绑定

**Conversation 来源（Conversation Source）**：Conversation 首次创建时的入口类型；它不决定后续 Turn 的回复目标。
_Avoid_: 当前入口、回复渠道

**Turn 来源（Turn Origin）**：某个 Agent Turn 实际由 Web/Desktop、飞书或微信发起的事实，并决定该 Turn 的结果投递目标。
_Avoid_: Conversation 来源

**频道投递（Channel Delivery）**：根据 Turn 来源，把已持久化的消息、状态和审批提示投递到对应 IM 私聊的模块。
_Avoid_: Agent Runtime 内置平台发送

**频道 receipt**：记录外部消息接收或回复投递状态的幂等事实，用于去重和重试；不承载 Conversation 内容。
_Avoid_: 消息副本、Conversation
