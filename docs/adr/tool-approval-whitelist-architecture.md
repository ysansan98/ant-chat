# ADR：工具记忆授权由 Agent Runtime 统一裁决

## 状态

已被 [ADR-0001：交互审批采用结构化权限规则与独立存储](./0001-tool-approval-rules.md) 取代，2026-07-22。

本文仍用于解释 2026-07-21 时的旧实现及其审批事务背景；白名单数据结构、匹配粒度、存储位置和管理方式不再作为实施依据。

## 背景

交互 Turn 可以在用户批准工具调用时记住授权。旧实现将授权保存为
`toolName + toolScope + glob pattern`，并为 Bash 自动生成 `${executable} **`。
因此批准一次具体 Node 脚本后，会形成 `node **`，随后任意 Node 程序都能跳过审批。

旧实现还把一次审批拆成两个 owner：App Runtime 先保存规则，Agent Runtime 再校验
`actionId` 并释放等待者。错误或过期的 `actionId` 可能导致审批失败但规则已经落库。

Trace 同时存在两种真实判定：基础策略先得到 `require_approval`，记忆授权命中后最终
得到 `allow`。旧数据只提供一个 `basis`，导致 UI 把“工作区外需要审批”和“命中规则
允许执行”展示为互相冲突的最终依据。

## 决策

### 1. 基础策略保持纯函数

`decidePolicy(mode, operationType, scope)` 只负责基础策略。记忆授权只能满足
`require_approval`，不能覆盖 `block`，自动化 Turn 也不读取交互授权规则。

```text
工具调用
  -> 基础策略 allow / require_approval / block
  -> 仅 require_approval 查询记忆授权
  -> 命中则 allow，否则等待用户审批
```

### 2. Agent Runtime 是审批事务的唯一 owner

前端只发送：

```ts
{
  taskId: string
  actionId: string
  remember?: 'workspace' | 'global'
}
```

Agent Runtime 必须按以下顺序处理：

1. 校验任务仍在等待审批且 `actionId` 匹配。
2. 从 pending action 读取后端生成的授权候选。
3. 从任务快照派生 workspace，禁止前端提交任意 `workspacePath`。
4. 持久化成功后，清除 pending action 并释放审批等待者。
5. 持久化失败时保持等待审批状态，不执行工具。

App Runtime 只提供持久化 adapter，不再编排“保存规则 + 批准任务”。独立的
`approvePendingActionWithWhitelist` 接口被删除。

### 3. 规则描述能力，不描述可执行文件前缀

记忆授权条目显式包含 `operationType`、`toolScope`、精确能力键和用户可读描述。

- 文件工具按 canonical 绝对路径精确匹配；目标尚不存在时绑定最近存在祖先的真实路径，
  内容等非权限字段不参与匹配。
- 普通 Bash 命令按执行 PATH 解析出的每个可执行文件真实路径、参数与 cwd 精确匹配。
- `node <script> ...` 按当前执行 PATH 解析出的解释器真实路径、脚本路径与 cwd 匹配，可复用该脚本的
  子命令，但不能扩大为其他 Node 解释器、其他脚本或 `node -e`。
- 带自定义环境变量的 Bash 调用不提供持久授权候选，避免通过 `NODE_OPTIONS` 等变量
  扩大能力。
- MCP 和其他工具按稳定序列化后的完整输入精确匹配，不再默认生成 `*`。

旧 glob 无法还原用户当时批准的具体资源和输入，设置 schema 升级时统一撤销。
安全性优先于无感兼容。

### 4. Trace 同时记录基础判定和最终判定

policy span started 记录：

```ts
initialDecision: {
  outcome: 'require_approval'
  basis: 'scope.outside'
}
```

span completed 记录：

```ts
effectiveDecision: {
  outcome: 'allow'
  basis: 'approval-grant.match'
}
```

UI 在两者不同时分别展示“基础判定”和“最终依据”，不根据是否存在规则字段自行猜测。

### 5. 安全默认值

- “记住此授权”默认关闭。
- 开启后默认只对当前工作区生效。
- 全局授权必须由用户显式选择。
- `blocked` scope 不能出现在持久授权 schema 中。

## 失败语义

- 规则读取失败：policy span 记录失败，当前 Turn 失败，不降级为自动允许。
- 规则写入失败：pending action 保持有效，工具不执行。
- action 不匹配：不写规则，不改变审批状态。
- 用户拒绝或取消：不写规则。
- 自动化 Turn：继续使用自身穷举权限策略，不等待交互审批。

## 验证门槛

- 同一 Node 脚本的不同子命令可复用授权。
- 该授权不能放行其他 Node 脚本或 `node -e`。
- 错误 `actionId` 不产生持久化副作用。
- 持久化失败不返回允许执行。
- strict、hybrid、full-managed 和 automation 的既有策略边界保持不变。
- Trace 同时保留基础判定与最终依据。
- 设置迁移撤销全部旧 glob 授权。

## 后续

持久授权仍需设置页提供列表、审计和撤销入口。若未来提供 Skill 级长期授权，应绑定
Skill 身份以及版本或内容摘要，不能根据模型先前调用过 `use_skill` 推断来源。
