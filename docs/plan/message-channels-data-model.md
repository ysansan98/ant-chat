# 消息频道：数据模型与领域边界

## 状态

已确认，供后续实施会话执行。本文只定义数据模型、所有权和行为合同，不包含平台 SDK 实现。

## 目标

增加个人微信（Weixin）和飞书的 1v1 消息入口，同时复用现有 `conversations`、`messages`、Agent Runtime、权限和前端事件投影。

首版不做企业微信、群聊、媒体入站解析、主动自动化推送和公网 Webhook；
出站附件（文件/图片/文档，微信 iLink 与飞书）在首版范围内。

## 核心关系

```text
ChannelAccount 1 ── * ChannelPairing
      │
      └──── * ChannelSession 1 ── 1 active Conversation

Conversation 1 ── * Message
Message(user) ── 1 Turn Origin ── 0..1 Channel target
Message receipt ── 1 external platform event or delivery attempt
```

关键区分：

- `Conversation Source` 只记录 Conversation 首次从哪里创建；
- `Turn Origin` 记录每次 Turn 的实际入口；
- 同一个 Conversation 可以交叉接受 Web/Desktop、飞书和微信消息；
- 每个 Turn 的回复回到发起该 Turn 的入口；
- 不用当前 `ChannelSession` 猜测历史 Turn 的回复目标。

## 现有表扩展

### `conversations`

新增字段：

```text
source_type              local | feishu | weixin | wecom
source_channel_account_id  nullable
source_external_chat_id    nullable
```

约束：

- `local` 时两个频道字段为空；
- 频道来源时两个字段必须存在；
- 不对这三个字段建唯一约束；同一个外部私聊可以通过 `/new` 创建多个历史 Conversation；
- Conversation 的 `workspace_path` 在创建时确定，后续不可修改；
- 断开频道不删除 Conversation、Message 或 Execution Trace。

### `messages`

仅在一个 Turn 的初始 user Message 上记录入口：

```text
origin_type                 local | feishu | weixin
origin_channel_account_id   nullable
origin_external_chat_id     nullable
```

后续 assistant/tool/steering Message 通过现有 `turn_id` 关联到初始 user Message。当前实现中初始 user Message 的 `id` 会作为 Turn ID 使用，即使它自身的 `turn_id` 为空；投递模块按该 ID读取入口事实。

消息内容仍只有一份：平台分段、投递状态和外部消息 ID 不写入消息内容。

## 新增持久化对象

### `channel_accounts`

保存非敏感连接配置；敏感值只保存 `credential_ref`，由 SecretStore 持有明文：

```text
id                         稳定本地账号 ID
channel_type               feishu | weixin
display_name               用户可见名称
credential_ref             SecretStore 引用
default_workspace_path     必须是已登记且可用的 workspace
enabled                    boolean
status                     configured | connecting | connected | degraded | disconnected
last_error                 脱敏诊断，可为空
created_at
updated_at
```

首版每个平台最多一个账号；底层保留稳定 `id`，不为多账号 UI 预留复杂路由。

### `channel_pairings`

保存消息身份授权：

```text
id
channel_account_id
external_user_id
external_display_name
status                     pending | authorized | revoked | expired
requested_at
expires_at
approved_at
```

飞书首次消息走配对流程。微信 QR 登录若返回 owner 身份，则先自动允许该身份；身份缺失或不一致时回退到同一配对流程。

配对是本机所有者对外部消息身份的 allowlist，不创建本地账号。

### `channel_sessions`

保存外部私聊到当前 Conversation 的路由：

```text
channel_account_id
external_chat_id
active_conversation_id
current_workspace_path
created_at
updated_at
```

唯一键：`(channel_account_id, external_chat_id)`。

行为：

- 首次私聊使用 ChannelAccount 的 `default_workspace_path` 创建 Conversation；
- `/new` 创建新 Conversation 后更新 `active_conversation_id`；
- `/new` 无参数继承 `current_workspace_path`；
- `/new <path>` 校验并 canonicalize 后创建新 Conversation，并更新当前工作区；
- 修改账号默认工作区不回写已有 Session 或 Conversation；
- Session 只保存当前指针和当前工作区，不保存第二份模型配置；模型以 active Conversation settings 为准。

### `channel_message_receipts`

保存外部事件幂等和投递事实：

```text
id
channel_account_id
external_chat_id
external_message_id
direction                   inbound | outbound
local_message_id            nullable
status                      received | sent | failed
part_index                  nullable
part_count                  nullable
last_error                  nullable
created_at
updated_at
```

唯一键：`(channel_account_id, external_message_id, direction, part_index)`。

receipt 不替代 `messages`：

- `messages` 是唯一对话内容；
- receipt 负责 webhook/long-poll 重复事件去重和发送重试；
- 平台分段只产生多个 outbound receipt，不产生多个 assistant Message。

## Conversation 与工作区

现有 Agent Runtime 会把 Conversation 的工作区 canonicalize 后放入 task snapshot，并供工具注册、文件策略、审批规则和 system prompt 使用。因此 `/cwd` 被删除，不能原地修改 `Conversation.workspacePath`。

唯一入口是：

```text
/new [path]
```

有 path 时必须经过 workspace service：路径存在、可访问、canonicalize 后合法，并登记为 workspace 或其合法子目录。无 path 时继承频道 Session 当前工作区；首次创建时使用 ChannelAccount 默认工作区。

## 消息和命令

命令在 ChannelRuntime 进入 Agent 前解析，不交给模型：

```text
/new [path]
/model <名称>
/models
/steer <text>
/stop
/status
/help
/approve
/deny
```

- `/new`、`/model`、`/models`、`/stop`、`/status`、`/help` 作为可审计 event Message 持久化，但不进入模型上下文；
- `/steer` 是实际 Turn 输入，沿用现有 steering 持久化；
- `/approve`、`/deny` 只操作当前 Conversation 的队首 pending action；多个审批严格 FIFO，一次只展示一个；
- `/model` 使用用户可见模型名/别名；歧义时返回候选，不暴露 providerId 要求用户输入；后端最终保存真实 provider/model 设置。

## 生命周期与失败合同

- ChannelAccount 启用后随 `activateAppRuntime()` 自动连接；停止/退出时优雅关闭；连接失败隔离，不阻断本地 Agent；
- Feishu 使用 WebSocket，Weixin 使用 long-polling；首版不开放公网 Webhook；
- 未配置默认 workspace 时，账号不能进入可用状态；收到消息只返回配置提示，不创建 Conversation；
- 入站事件先在事务中完成 receipt 去重、Session 解析和 user Message 入库，再启动 Agent Turn；
- 重复事件不重复创建 Message 或执行 Agent；
- Turn 启动失败保留 user Message，标记 receipt failed；重试必须复用原 userMessageId；
- outbound 失败不回滚本地 Message 或 Turn，按 receipt 重试并保留脱敏错误；
- 断开频道删除凭据、连接和临时授权状态，但不删除历史业务数据；
- Web/Desktop 继续通过现有 `conversation:updated`、`message:updated`、`agent:task-updated` 事件接收后台变化；非当前 Conversation 更新列表/未读，打开时重新加载消息。
