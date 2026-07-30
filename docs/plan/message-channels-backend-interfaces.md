# 消息频道：Backend Module 与 Interface 设计

## 设计原则

频道模块是一个 deep module：平台差异、重连、QR/setup、消息格式、限流、重试和投递分段隐藏在 connector/投递实现内；Agent Runtime 只看到统一的入口和现有事件。

外部 seam 放在 `packages/backend/src/channels/`，Runtime 注册放在 `app-runtime/modules/channel`，控制面通过现有 AppControl/RouteRegistry 暴露。Agent Runtime 不 import 飞书或微信 SDK。

## 模块分工

### `ChannelModule`

Runtime module，持有频道整体生命周期：

- 读取/保存非敏感频道配置；
- 通过 SecretStore 解析凭据引用；
- 激活/停止 connector；
- 接收设置页/CLI 的控制命令；
- 暴露脱敏状态；
- 连接失败隔离并发布频道状态事件。

它不解析 Agent prompt，不执行工具，不直接维护前端 store。

### `ChannelConnector`

平台 Adapter 的 seam。一个 connector 对应一个平台：`FeishuConnector` 或 `WeixinConnector`。

建议 interface（实现时可按现有类型命名调整）：

```ts
interface ChannelConnector {
  readonly type: 'feishu' | 'weixin'

  setup(input: ChannelSetupInput): Promise<ChannelSetupResult>
  start(input: ChannelStartInput): Promise<void>
  stop(): Promise<void>
  send(input: ChannelSendInput): Promise<ChannelSendResult>
  getStatus(): ChannelConnectionStatus
}
```

接口合同：

- `setup` 负责平台特有扫码/凭据注册，返回脱敏账号资料和 SecretStore 要保存的凭据，不直接写设置文件；
- `start` 建立连接并把平台原始事件归一化后交给 `onInbound`；
- `send` 只发送已归一化的文本/阶段状态，平台分段在 Adapter 内完成；
- `stop` 幂等，必须释放 WebSocket、long-poll、计时器和 pending request；
- connector 不知道 Conversation、Agent Turn、workspace 和权限规则；
- 单个 connector 失败不得使 `ChannelModule` 或 AppRuntime 失败。

### `ChannelRuntime`

隐藏在 ChannelModule 内的深实现，拥有统一入站语义：

```ts
interface ChannelRuntime {
  handleInbound(event: ChannelInboundEvent): Promise<ChannelInboundResult>
  executeCommand(input: ChannelCommandInput): Promise<ChannelCommandResult>
}
```

`handleInbound` 的固定顺序：

```text
平台事件
  -> connector 归一化
  -> 账号/连接状态校验
  -> external user 配对校验
  -> receipt 幂等检查
  -> Session 解析或创建
  -> command 解析
       ├─ 控制命令：持久化 event Message，执行控制面动作
       └─ 普通文本：持久化 user Message，启动 Agent Turn
  -> 返回平台 ack
```

普通文本启动 Turn 时，必须传入：

```ts
turnSource: {
  type: 'channel',
  channelType: 'feishu' | 'weixin',
  channelAccountId: string,
  externalChatId: string,
  externalMessageId: string,
}
```

这扩展现有 `AgentTurnSource`，用于权限/观测/投递路由；不改变现有 `toolAuthorization` 的裁决顺序。

### `ChannelCommandParser`

纯函数模块，输入原始文本，输出命令或普通文本：

```ts
type ChannelCommand =
  | { id: 'new'; path?: string }
  | { id: 'model'; query: string }
  | { id: 'models' }
  | { id: 'steer'; text: string }
  | { id: 'stop' }
  | { id: 'status' }
  | { id: 'help' }
  | { id: 'approve' }
  | { id: 'deny' }

type ParsedChannelInput =
  | { kind: 'command'; command: ChannelCommand }
  | { kind: 'text'; text: string }
```

路径解析必须支持包含空格的路径；建议复用现有 builtin command 的参数规则或使用“命令名后保留完整 remainder”的明确规则，不能静默拆错路径。

解析失败只返回用户可读错误，不降级为普通 Agent 文本。

### `ChannelDelivery`

独立于 Agent Runtime 的投递协调器，订阅现有 runtime events：

```text
AgentRuntime 持久化 Message / Task / Approval event
  ├─ Web/Desktop 现有事件投影
  └─ ChannelDelivery 按 Turn Origin 发送 IM
```

它的接口应尽量小：

```ts
interface ChannelDelivery {
  start(): void
  stop(): void
}
```

内部行为：

- `message:updated`：识别 channel Turn 的 user/assistant/tool 变化；
- `agent:task-updated`：发送阶段状态和终态变化；
- `agent:approval-required`：发送当前队首审批提示；
- 通过初始 user Message 的 origin 和 `turnId` 查找回复目标；
- 不使用当前 `channel_sessions.active_conversation_id` 作为历史 Turn 的投递目标；
- 多个审批只发送队首，批准/拒绝后再发送下一个；
- 平台分段由 connector 处理，原始 assistant Message 只保存一份；
- 发送结果写入 receipt，失败不改变 Agent Turn 状态。

## 控制面 Interface

新增 `channel` namespace，复用现有 AppControl/RouteRegistry，不从 Renderer 或 CLI 直接启动 connector。

建议能力集合：

```text
channel.list
channel.setup
channel.update
channel.enable
channel.disable
channel.disconnect
channel.getStatus
channel.listPairingRequests
channel.approvePairing
channel.rejectPairing
```

约束：

- setup 返回 QR/验证 URL 的短期状态，不把二维码凭据写入前端持久 store；
- 任何 public DTO 不包含 App Secret、iLink token 或 SecretRef 明文；
- `channel.update` 只接收非敏感配置和已校验 workspace；
- `channel.disconnect` 清理连接、凭据引用和临时 pairing/approval 状态，但不删除 Conversation/Message/Trace；
- 状态查询必须区分 `configured`、`connecting`、`connected`、`degraded`、`disconnected`，连接失败不能只返回 boolean。

## Agent Runtime 接入

不为频道复制 Agent loop。接入点只有三类：

1. `AgentTurnService.startTurn` 接收 channel `turnSource`，并持久化 user Message origin；
2. `AgentRuntime`/`TaskStore` 继续负责 steering、stop、approval、secret 和任务终态；
3. AppRuntime event bus 继续发出 message/task/approval 事件，由 ChannelDelivery 消费。

权限合同保持不变：频道身份不会绕过 `toolAuthorization`、输入校验、deny/block、workspace scope 或 SecretRef 生命周期。

## 测试 seam

必须可以用 fake connector 测试完整链路，不连接真实飞书/微信：

- connector setup/start/stop/send 合同测试；
- 配对、拒绝、撤销、微信 owner 自动授权回退；
- receipt 去重、入库后启动、启动失败复用原 userMessageId；
- Session 首次创建、`/new`、默认 workspace 和非法 path；
- 命令解析、模型歧义、FIFO 审批、跨入口 steering；
- Turn Origin 到 ChannelDelivery 的路由；
- Web/Desktop 现有 `message:updated`/`agent:task-updated` 投影不回归；
- AppRuntime 激活、重连、断开和 connector 失败隔离。
