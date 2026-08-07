# 消息频道实施交接

## 交接目标

在新会话中按既定规格实施个人微信（Weixin）和飞书消息频道。本文是实施入口；完整模型见：

- [数据模型与领域边界](./message-channels-data-model.md)
- [Backend Module 与 Interface 设计](./message-channels-backend-interfaces.md)

## 已确认决策

- 单机单所有者；不引入本地账号、多租户或外部用户系统。
- 首版只做 1v1、纯文本、交互式 Turn。
- 平台是个人微信和飞书；企业微信另作 connector。
- 每个平台首版最多一个账号；内部仍使用稳定 `channelAccountId`。
- 飞书扫码创建应用并使用 WebSocket；微信 iLink QR 登录并使用 long-polling。
- 频道必须配置默认 workspace；`/new [path]` 经过 workspace service 并创建新 Conversation。
- 删除 `/cwd`。
- 复用现有 `conversations`、`messages`、Agent Runtime、权限、Trace 和 Renderer 事件。
- Conversation 来源与 Turn 来源分离；跨 Web/Desktop/IM 交叉续聊；回复回原始 Turn 入口。
- `/model` 使用用户可见模型名；`/models` 展示候选。
- IM 审批使用 `/approve`、`/deny`，每个 Conversation 严格 FIFO，一次一个。
- Web/Desktop 必须继续接受后端 `message:updated`、`conversation:updated`、`agent:task-updated` 推送。
- SecretStore 是平台敏感凭据 owner；断开不删除历史会话。
- 自动化主动推送是后续迭代，不进入首版。

## 推荐实施顺序

### 阶段 1：领域类型与数据库迁移

涉及方向：

- shared conversation/message/source 类型；
- SQLite schema、rows、migration、repositories；
- `channel_accounts`、`channel_pairings`、`channel_sessions`、`channel_message_receipts`；
- 唯一约束和失败恢复测试。

先完成 fake 数据和迁移测试，不接平台 SDK。

### 阶段 2：ChannelRuntime 与命令

实现：

- `ChannelCommandParser`；
- 配对和 owner 自动授权；
- Session 路由；
- `/new [path]`、`/model`、`/models`、`/steer`、`/stop`、`/status`、`/help`、`/approve`、`/deny`；
- 入站 receipt 事务和 AgentTurnSource；
- fake connector 端到端测试。

验收：同一外部私聊重复事件只生成一个 Message/Turn；`/new` 保留旧会话；非法 workspace 不启动 Turn。

### 阶段 3：ChannelDelivery 与事件投影

实现：

- 订阅现有 AppRuntime event bus；
- 从初始 user Message origin 恢复 Turn 投递目标；
- 状态消息、最终回复、审批 FIFO、分段 receipt；
- 发送失败重试，不回滚本地业务状态。

验收：IM Turn 由 Web 继续时仍回复 IM；Web Turn 不回发 IM；Desktop/Web 都能看到后台消息更新。

### 阶段 4：AppRuntime/AppControl/设置页

实现：

- `channel` Runtime module；
- AppControl 命令和脱敏 DTO；
- SecretStore credential ref；
- 设置页扫码、默认 workspace、启停、状态、配对批准；
- Runtime 激活/停止/重连。

### 阶段 5：平台 Adapter

先接飞书，再接微信：

- 飞书：官方 scan-to-create、WebSocket、私聊文本、事件校验；
- 微信：iLink QR、long-polling、owner user ID 自动授权、配对回退、私聊文本；
- 当前状态：飞书已接入；微信已完成代码实现，等待真实 iLink 扫码/长轮询联调。

平台 SDK 只能位于 adapter；不得把平台对象泄漏到 shared domain 或 Agent Runtime。

## 不得自行扩张的范围

- 不实现企业微信、群聊、媒体、主动自动化推送、公网 Webhook；
- 不创建本地账号或权限系统；
- 不让频道绕过现有权限裁决；
- 不让 `/cwd` 修改已有 Conversation；
- 不把平台分段写成多条 assistant Message；
- 不按当前 active channel session 猜历史 Turn 的回复目标；
- 不让 Connector 直接调用 Agent loop；
- 不在配置 DTO、日志、Trace 或消息中泄露 App Secret、iLink token、SecretRef 明文；
- 不用兼容旁路或 dual-write 保留旧频道模型。

## 关键失败路径

必须行为测试覆盖：

1. 无默认 workspace：频道不处理消息，不创建 Conversation；
2. 未配对身份：返回配对提示，不创建 Message/Turn；
3. 重复平台事件：receipt 去重，不重复执行；
4. 入库后启动失败：保留原 user Message，允许复用原 ID 重试；
5. connector 断线：频道状态 degraded/重连，不阻断本地 Agent；
6. 发送失败：本地消息保持成功，receipt 标记失败并重试；
7. Web/Desktop 收到后台消息：非当前会话更新列表/未读，打开后重新加载；
8. 多个审批：只发送队首，处理后再发送下一个；
9. `/new` 运行期间执行：旧 Turn 保持旧 workspace，新 Conversation 使用新 workspace；
10. 微信 owner 身份不一致：自动授权失败，回退配对流程。

## 验证门槛

定向测试完成后运行：

```bash
pnpm type-check
pnpm lint
pnpm test:unit
git diff --check
pnpm check
pnpm build
```

平台真实联调需要记录：扫码创建/登录、重启恢复、重复事件、断网重连、长回复分段、审批 FIFO、Web/Desktop 推送和断开后历史保留。

## 当前工作树注意事项

交接时工作树已有大量与 MCP/AppRuntime/SecretStore 相关的未提交修改。实施新功能前必须以当前工作树为事实基线，不要 reset、checkout 或覆盖这些改动；频道改动应保持文件范围可识别。
