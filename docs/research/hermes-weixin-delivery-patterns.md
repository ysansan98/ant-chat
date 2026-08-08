# Hermes 个人微信（iLink）消息发送模式与 ant-chat 落地建议

> 调研日期：2026-08-08
> 参考实现：`~/.hermes/hermes-agent/gateway/platforms/weixin.py`（WeixinAdapter）
> 关联代码：`~/.hermes/hermes-agent/gateway/platforms/base.py`、`gateway/stream_consumer.py`、`gateway/run.py`

## 结论

Hermes 对接个人微信走腾讯 iLink bot 协议（`ilinkai.weixin.qq.com`）：QR 登录换取 bot token，`getupdates` 长轮询收消息，`sendmessage` 发消息，`sendtyping` 控制输入状态。微信不能编辑已发送的消息，所以 Hermes 对微信完全关闭流式增量发送，等 Agent 生成完整终态后一次性投递。

它真正值得学的是投递前的三层处理：**Markdown 块级拆分、长行折行、逐条可靠发送**。核心规则：

1. 单条消息上限 2000 字符；超出时按 Markdown 块（`block`）打包拆分，代码块整体不拆。
2. 默认"紧凑模式"：整段不超过上限就发一条，只有"短对话式"的多行文本（2-6 行、每行像一句聊天话语）才拆成独立气泡。
3. 超长单块用 `truncate_message` 兜底：跨块时补闭合/重开代码 fence，并在每条末尾加 `(1/3)` 分块指示。
4. 普通显示行超过 120 字符自动折行（代码块、表格行除外），解决微信长行复制困难。
5. 发送时逐条串行，块间固定间隔 1.5 秒，每条独立 `client_id`、独立重试（默认 4 次）、限流熔断、session 过期降级重试。

ant-chat 当前微信发送是 `connector.send()` → `transport.sendText()` 一次调用整段发出，没有长度上限、块级拆分、折行和逐块重试，这是体验差距的主要来源。

## 对接架构总览

| 环节 | 实现 |
| --- | --- |
| 登录 | `ilink/bot/get_bot_qrcode` + `get_qrcode_status` 轮询，确认后落盘 `account_id`/`token`/`base_url`/`user_id` |
| 入站 | `ilink/bot/getupdates` 长轮询（默认超时 35s，服务端可下发 `longpolling_timeout_ms`），消息经去重后进会话 |
| 出站文本 | `ilink/bot/sendmessage`，`item_list[0].type=1` + `text_item.text` |
| 出站媒体 | `getuploadurl` 拿上传地址 → AES-128-ECB 加密 → POST 原始密文到 CDN |
| 输入状态 | `getconfig` 拿 `typing_ticket`（600 秒 TTL，过期自动刷新）→ `sendtyping` 置 1/2 |
| 会话续期 | 入站消息带 `context_token`，出站时回传；`errcode=-14` 时去掉 token 重试一次兜底 |

发送消息体（`weixin.py:438` 附近）：

```python
message = {
    "from_user_id": "",
    "to_user_id": to,
    "client_id": client_id,        # 每条 chunk 独立 UUID，幂等
    "message_type": MSG_TYPE_BOT,  # 2
    "message_state": MSG_STATE_FINISH,  # 2
    "item_list": [{"type": ITEM_TEXT, "text_item": {"text": text}}],
}
if context_token:
    message["context_token"] = context_token
```

## 为什么微信不走流式

`WeixinAdapter.SUPPORTS_MESSAGE_EDITING = False`（`weixin.py:1146`）。`run.py` 在创建 `GatewayStreamConsumer` 前检查该能力位：

- 正常 Agent 运行路径：`not _adapter_supports_edit` 直接抛错跳过 stream consumer，`stream_delta_callback` 不注册，Agent 生成完整响应后走 `adapter.send()` 终态发送（`run.py:16851` 附近）。
- 流式游标：非可编辑平台 `_effective_cursor = ""`，避免留下永远清不掉的 `▉`（`run.py:15640` 附近）。

结论：微信没有"边生成边更新一条消息"的通道，Hermes 选择**放弃中间态展示**，用输入状态指示器（`sendtyping`）让用户知道 bot 在干活，把体验全部押在终态内容的组织上。

## 发送主链路（`WeixinAdapter.send`）

```text
send(chat_id, content)
  ├─ extract_media / extract_images / extract_local_files：先抽 MEDIA: 标签、图片、裸文件路径
  │    └─ 逐个 send_document / send_video / send_voice（失败只记日志不阻塞文本）
  ├─ format_message(content)
  │    └─ _normalize_markdown_blocks() + _wrap_copy_friendly_lines_for_weixin()
  ├─ _split_text(content)  → _split_text_for_weixin_delivery(content, 2000, split_multiline_messages)
  └─ 逐 chunk：
       ├─ client_id = hermes-weixin-<uuid>
       ├─ _send_text_chunk()（全局 _send_text_gate 锁串行）
       ├─ 失败重试：send_chunk_retries=4 次，退避 1s * (attempt+1)
       ├─ 限流(errcode=-2)：3x 退避；窗口 30s 内命中阈值即熔断 30s
       ├─ session 过期(errcode=-14)：去掉 context_token 重试一次
       └─ 块间隔 sleep(send_chunk_delay_seconds=1.5s)
```

媒体先发、文本后发，文本内部严格串行。`_send_text_gate` 是适配器级锁，防止并发的 cron 推送和回复互相插队触发 iLink 限流。

## Markdown 拆分机制（重点）

微信客户端本身能渲染 Markdown（`supports_code_blocks = True`），但 Hermes 认为"整段一大坨"在聊天里可读性差，于是设计了三层处理管线：

```text
原始输出
  → ① _normalize_markdown_blocks()   空行规整、保留代码块
  → ② _wrap_copy_friendly_lines_for_weixin()  长显示行折行（120 列）
  → ③ _split_text_for_weixin_delivery()  块级拆分（≤2000 字符/条）
```

### ① 空行规整（`_normalize_markdown_blocks`）

- 连续空行压缩为最多 1 个空行，避免模型输出的大段空行刷屏。
- 三反引号 fence 内的内容原样保留，不压缩、不折行。

### ② 长行折行（`_wrap_copy_friendly_lines_for_weixin`）

- 普通显示行超过 `WEIXIN_COPY_LINE_WIDTH = 120` 字符时用 `textwrap` 折行（不拆单词、不拆连字符）。
- 跳过：代码块内、表格行（`|` 开头）、表头分隔行（`:---`）、空行。
- 动机：微信选中复制的区域以行为单位，超长行复制体验极差。

### ③ 块级拆分（核心决策树）

先看总长度：

```text
len(content) <= 2000？
├─ 是：看起来像"短对话块"？→ 是则按 delivery unit 拆成多个气泡；否则整段一条
└─ 否：_pack_markdown_blocks_for_weixin() 按 block 打包，尽量合并，单块超限再拆
```

**短对话块识别**（`_should_split_short_chat_block_for_weixin`）：2-6 个非空行，首行不是标题（`#` 开头或 `≤24 字符且以 :/：` 结尾），且每一行都"像一句聊天话语"：

- 长度 ≤ 48 字符
- 非缩进开头
- 不是引用 `>`、列表 `-`/`*`、`【`、`#`、`|` 开头
- 不是表格分隔行、不是纯 `**加粗**` 整行、不是 `1. ` 数字列表

命中的典型形态是 `好的\n我马上处理` 这类多句口语，拆开更自然；命不中的结构化 Markdown（标题/列表/表格）保持整段。

**Markdown 块定义**（`_split_markdown_blocks`）：空行分隔的连续行是一个块；三反引号 fence 无论内部如何都算一个完整块（`_FENCE_RE` 匹配 ` ``` ` 开头，`_split_delivery_units_for_weixin` 遇 fence 块整体跳过）。

**打包规则**（`_pack_markdown_blocks_for_weixin`）：

```text
for block in blocks:
    当前候选 = current + "\n\n" + block
    候选 ≤ 2000 → 继续合并
    候选 > 2000 → 先落 current；block 本身 ≤ 2000 就作为新 current
    单 block > 2000 → truncate_message(block, 2000) 兜底拆
```

**Delivery unit**（legacy `split_per_line=True` 及短对话块用）：顶层级空行/换行拆成独立单元；缩进续行（`is_continuation = 行首空格/Tab`）归并到上一行，避免嵌套列表项被拆散。

### `truncate_message` 兜底（`base.py`）

单块超限时的最后手段，专门为代码块做了保护：

- 若切点落在未闭合的代码块内，当前 chunk 末尾补 `\n``` ` 闭合，下一条用原语言标签重开 ` ```lang\n`。
- 优先在换行/空格处切，避免从词中间截断。
- 内联代码 span（`` ` ``）不配对时回溯到上一个反引号前的空格再切，避免破坏 Markdown 转义。
- 多 chunk 时每条追加 ` (i/n)` 指示（预留 10 字符）。
- `max_length` 用 `message_len_fn`（微信就是 `len`，Telegram 等用 UTF-16 单位）度量。

### 两种模式与配置

| 模式 | 行为 | 开关 |
| --- | --- | --- |
| compact（默认） | 能一条就一条；只有短对话块拆气泡 | `split_multiline_messages=false` |
| per_line（legacy） | 顶层换行即独立消息，超长单元再块打包 | `split_multiline_messages=true` 或环境变量 `WEIXIN_SPLIT_MULTILINE_MESSAGES` |

可调参数（代码默认值）：

| 参数 | 默认 | 作用 |
| --- | --- | --- |
| `MAX_MESSAGE_LENGTH` | 2000 | 单条文本上限（iLink 实际分块约 2048） |
| `send_chunk_delay_seconds` | 1.5 | 相邻消息间隔，防刷屏/限流 |
| `send_chunk_retries` | 4 | 每条 chunk 重试次数 |
| `send_chunk_retry_delay_seconds` | 1.0 | 重试基础退避 |
| `rate_limit_circuit_threshold` | 1 | 30s 窗口内限流命中次数达阈值熔断 |
| `rate_limit_circuit_open_seconds` | 30 | 熔断时长 |

## 入站侧配套（简述）

体验是双向的，Hermes 对入站也做了对应处理：

- **文本批处理**：iLink 会把转发/粘贴的连续多条拆成独立消息，Hermes 用 debounce（默认 3s 静默期，单条 ≥1800 字符用 5s）合并后再触发一次 Agent 调用，避免连续打断。
- **消息去重**：`message_id` 去重 + 文本 MD5 指纹去重（5 分钟 TTL），防 iLink 重投。
- **输入状态**：入站即 `sendtyping` 置输入中，终态送达后置停止；ticket 过期自动通过 `getconfig` 刷新，避免"输入中"卡死。

## ant-chat 现状与差距

对照点（`packages/backend/src/channels/weixin/transport.ts`、`connector.ts`、`channelDelivery.ts`）：

| 能力 | Hermes | ant-chat 现状 | 差距影响 |
| --- | --- | --- | --- |
| 单条长度上限 | 2000 拆分 | 无上限，整段直发 | 超长回复可能被 iLink 截断或发送失败 |
| Markdown 块拆分 | block 感知打包 + fence 保护 | 无 | 代码块可能被拆断、气泡不可读 |
| 长行折行 | 120 列折行 | 无 | 微信复制长行困难 |
| 多消息间隔 | 1.5s + 串行锁 | 无 | 多条消息连续到达触发限流 |
| 逐块重试 | 4 次重试 + 退避 | 发送失败整体抛错 | 偶发失败即丢整段 |
| 限流熔断 | 30s 熔断 | 无 | 触发 iLink 频率限制后无退避 |
| session 过期降级 | 去 `context_token` 重试 | 直接失败 | 长时间不活跃后回复失败 |
| 流式 | 完全关闭，终态一次发 | 终态一次发（`scheduleExecution` 对无 `update` 平台直接不发中间态） | 一致 |
| 输入状态 | `sendtyping` + ticket 自动刷新 | `setTyping` 有实现 | 基本一致 |
| 入站批处理 | 3s/5s debounce + 去重 | 无 | 转发/连发消息会逐条打断 Agent |

ant-chat 的 `sendText` 还要求必须先有 `context_token`（`尚未收到该用户的微信消息，无法回复。`），Hermes 则允许无 token 降级发送，保证 cron/主动推送可用。

## 落地建议（按优先级）

1. **发送前拆分**：在 `WeixinConnector.send` / `transport.sendText` 前加一个纯函数 `splitWeixinDelivery(text, max=2000)`，复刻 Hermes 的"block 打包 + 超长 truncate + fence 保护"三层逻辑。这是体验差的核心修复，无外部依赖。
2. **逐块发送可靠性**：`sendText` 改为循环发送，块间隔 1.2-1.5s；单块失败重试 2-3 次（指数退避）；`errcode=-14` 时去掉 `context_token` 重试一次；`-2` 限流退避。
3. **长行折行**：普通显示行 >120 字符折行，跳过代码块/表格行；空行压缩为单个。
4. **入站批处理**：参照 3s/5s debounce 合并转发/连发消息，减少打断。
5. **配置化**：以上参数放进频道账户配置或环境变量，默认值与 Hermes 对齐；`split_multiline_messages` 提供 compact/per_line 两档。

注意保持 ant-chat 的架构边界：拆分是 **Weixin connector 内部实现**，不应上浮到 shared RPC 或 `ChannelDelivery` 通用层；`ChannelDelivery` 继续只管"终态发一次"，与现状一致。

## 实施状态（2026-08-08）

建议 1-5 已在 `packages/backend/src/channels/weixin/` 落地：

- 拆分/折行纯函数：`delivery.ts`（`normalizeMarkdownBlocks` / `wrapCopyFriendlyLines` / `splitWeixinDelivery` / `truncateMessage`）。
- `WeixinConnector.send` 改为折行 + 块级拆分 + 逐条发送，块间隔可配置，返回最后一条消息 ID。
- `transport.sendText` 增加逐块重试（指数退避）、`errcode=-14` 去掉 `context_token` 降级重试一次、`-2` 限流 3x 退避。
- 入站文本按会话 debounce 合并（默认 3s，单条 ≥1800 字符放宽到 5s），非文本消息立即回调。
- typing ticket 按 600 秒 TTL 过期自动刷新，避免微信端"输入中"卡死。

可调环境变量：`WEIXIN_MAX_MESSAGE_LENGTH`、`WEIXIN_SEND_CHUNK_DELAY_MS`、`WEIXIN_SEND_CHUNK_RETRIES`、`WEIXIN_SEND_CHUNK_RETRY_DELAY_MS`、`WEIXIN_TEXT_BATCH_DELAY_MS`、`WEIXIN_TEXT_BATCH_SPLIT_DELAY_MS`、`WEIXIN_SPLIT_MULTILINE_MESSAGES`。

## 出站媒体链路（2026-08-08 落地）

以 `weixin.py` 的 `_send_file` 为对照，ant-chat 在 `transport.sendFile` 实现同款链路：

1. `ilink/bot/getuploadurl`，参数：`filekey`（16B hex 随机）、`media_type`（1=图片 2=视频 3=文件 4=语音）、`to_user_id`、`rawsize`、`rawfilemd5`（明文 MD5）、`filesize`（PKCS7 补位后大小）、`no_need_thumb: true`、`aeskey`（hex 字符串）。
2. 上传地址优先 `upload_full_url`，缺失时用 `upload_param` 构造 CDN URL（`https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=...&filekey=...`，base 可用 `WEIXIN_CDN_BASE_URL` 覆盖）。
3. AES-128-ECB + PKCS7 加密后 POST 原始密文到 CDN，`Content-Type: application/octet-stream`；响应头 `x-encrypted-param` 即最终 `encrypt_query_param`。上传必须 POST，旧 PUT 会 404。
4. `sendmessage` 媒体 item：
   - 图片 `image_item`：`media{encrypt_query_param, aes_key, encrypt_type:1}` + `mid_size`（密文大小）；
   - 文件 `file_item`：`file_name` + `len`（明文大小）；
   - 视频/语音原生气泡未验证，ant-chat 统一按文件发送。
5. 媒体发送同样回传 `context_token`，复用 `sendText` 的 session 过期降级重试逻辑。

已知坑（必须遵守）：

- `aes_key` 传 `base64(hex(key))`，不是 `base64(原始字节)`，否则接收端灰块。
- `filesize`/`mid_size`/`len` 必须精确：`filesize` 是补位后大小，`len` 是明文大小。
- `getuploadurl` 的 `aeskey` 是 hex 字符串，与 `sendmessage` 的 `aes_key` 编码不同。

ant-chat 侧：频道会话中 agent 通过 `send_attachment` 工具直接发送到当前会话（`ChannelModule.sendAttachment` → connector 透传），返回真实消息 ID，失败反馈给模型；桌面会话则把附件块附加到回复，由 `ChannelDelivery` 在消息落盘后从附件库加载字节投影。飞书走 `im.v1.image.create` / `im.v1.file.create` + `message.create`，文件类型枚举有限，未知类型落 `stream`。
