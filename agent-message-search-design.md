不能照搬设计稿。当前项目已经有两套不同职责的系统：

- `messages` 是 SQLite 原始证据源；当前搜索只是对 JSON text block 做 `LIKE`。
- `USER.md / MEMORY.md / SOUL.md` 是全局、短小、按会话冻结注入的 prompt 快照，不是可追溯的长期记忆。

把它们合成一套会破坏 compaction 和现有 prompt 快照语义。

## 目标架构

```text
messages（证据真相源，不改语义）
  └─ MessageSearchIndex（可重建的派生读模型）
       ├─ messages_fts_unicode
       ├─ messages_fts_trigram
       └─ message_tool_facts

MemoryCatalog（人工批准的结论层）
  ├─ memories / memory_evidence
  ├─ memories_fts_trigram
  └─ app-data/memories/<workspace-key>/<memory-id>.md
```

不要在项目根目录放 `.memory/`：项目文件可被 Git、外部工具或不可信工作区内容影响。长期记忆应存于 app-data，按 canonical workspace identity 隔离。

## Message Search

现状中，消息 ID 是随机值，不能用于窗口排序；真实会话顺序是 `created_at ASC, rowid ASC`。[SqliteMessageRepository](/Users/ysansan/webProject/ant-chat/packages/backend/src/data/sqlite/repositories/sqliteMessageRepository.ts:60) 因此设计稿的“按 ID 前后 N 条”应改成稳定的 `ordinal`：

```sql
ALTER TABLE messages ADD COLUMN ordinal INTEGER;

-- 新写入：在同一 conversation 内分配递增 ordinal
-- 历史回填：按 created_at, rowid 生成 ordinal
CREATE UNIQUE INDEX idx_messages_conversation_ordinal
  ON messages(conv_id, ordinal);
```

分配策略：better-sqlite3 是同步驱动，`SqliteMessageRepository.create` 已在 `db.transaction()` 内执行。在事务内用**单步原子分配**，禁止先查后插的两步法（并发事务可能读到相同 MAX 值）：

```sql
INSERT INTO messages (..., ordinal, ...)
VALUES (
  ...,
  (SELECT COALESCE(MAX(ordinal), 0) + 1 FROM messages WHERE conv_id = ?),
  ...
);
```

新增派生读模型，而不是重构 `messages.content` JSON：

```sql
CREATE TABLE message_search_documents (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  text TEXT NOT NULL,
  tool_text TEXT NOT NULL DEFAULT ''
);

CREATE TABLE message_tool_facts (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tool_call_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- call | result
  tool_name TEXT NOT NULL,
  server_name TEXT,
  args_text TEXT NOT NULL DEFAULT '',
  result_text TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(message_id, tool_call_id, kind)
);
```

`message_search_documents` 是搜索投影；由 `SqliteMessageRepository.create/update/delete` 在同一事务内维护，历史数据在 migration 中回填。不要直接对 `messages.content` 加触发器：现有内容是复杂 JSON、tool call/result 也内嵌其中，触发器会把抽取和兼容逻辑分散进 SQL。

投影维护规则：

- **`role='event'` 的消息不进入投影。** compaction summary 是压缩产物，不是原始证据；搜索应命中被压缩前的 user/assistant/tool 消息。
- **`text` 列**只填充用户可读文本：`text` block 的 `.text` + `error` block 的 `.error`。不包含 image/document/file/visualization 等二进制附件。
- **`tool_text` 列**填充工具相关文本：tool-call 的 `toolName` + `args`（JSON 序列化）+ tool-result 的 `result` 文本。用于检索"agent 调过什么工具、传了什么参数"。
- 结构化的 tool 事实另存 `message_tool_facts`，供精确查询（按 tool_name、server_name 过滤）。

FTS：

- `messages_fts_unicode`：unicode61，英文、标识符、路径。
- `messages_fts_trigram`：trigram，CJK 查询。
- CJK ≥ 3 字符走 trigram；1–2 CJK 走 `message_search_documents.text LIKE ? ESCAPE '\'`，并转义 `%`、`_`、`\`。
- FTS 查询统一按字面 phrase 构造，禁止把用户输入直接拼为 FTS 表达式。
- migration/test 先验证 bundled SQLite 实际支持 FTS5 trigram；不支持则显式降级为 LIKE，不能静默报空结果。

同步方式采用 **standalone FTS 表**（非 external content table）：

```sql
CREATE VIRTUAL TABLE messages_fts_unicode USING fts5(
  message_id UNINDEXED,
  text,
  tool_text,
  tokenize='unicode61'
);
```

选择 standalone 而非 external content table 的原因：`message_search_documents` 主键是 `message_id TEXT`，而 FTS5 external content table 要求 `content_rowid` 为整数，类型不匹配。standalone 表冗余存储 text/tool_text，但同步逻辑更简单。

同步时机：在 `SqliteMessageRepository.create/update/delete` 的同一事务内，手动执行 FTS 的 INSERT/DELETE。查询时先在 FTS 表搜索得到 `message_id` 列表，再 JOIN `message_search_documents` 获取 ordinal、conversation_id 等投影字段。

重建：migration 回填时执行 `INSERT INTO messages_fts_unicode(message_id, text, tool_text) SELECT message_id, text, tool_text FROM message_search_documents`。

Agent 搜索应实现为独立的后端模块，而不是复用 renderer RPC：

```ts
interface MessageSearch {
  search(input: {
    query: string
    workspacePath?: string
    conversationId?: string
    limit?: number
    cursor?: SearchCursor
    contextRadius?: number
  }): Promise<MessageSearchPage>

  getThread(input: {
    conversationId: string
    before?: number
    after?: number
    cursor?: MessageCursor
  }): Promise<MessageThreadPage>

  getTurn(input: { messageId: string }): Promise<MessageTurn>
}
```

保留 `searchMessages`、`getThread`，但把设计稿的 `trace(messageId)` 改为 `getTurn(messageId)`。

原因很直接：当前 schema 没有 `parent_id`，只有 `turn_id`；而且重试/分支没有显式因果边，无法诚实地“沿 parent 链追溯”。[messages schema](/Users/ysansan/webProject/ant-chat/packages/backend/src/data/sqlite/schema.ts:27) V1 返回“本 turn 的用户根消息 + 同 turn 消息 + 关联 compaction boundary”；以后真正需要分支，再增加显式 `message_edges`，不能伪造 parent 关系。

`MessageSearch` 是 agent 专用的一组内置 tool，不是前端搜索的后端。前端搜索保持现有 `SqliteMessageSearchQuery` + `search.searchByKeyword` RPC 不变，不在本次改造范围内。Agent tool 返回命中消息列表，由 agent 自行决定是否调用 `getThread`/`getTurn` 深入验证。

## 长期记忆

现有 `AgentMemoryManager` 保持不动，继续只负责：

- `SOUL.md`：身份与行为策略，仅用户编辑；
- `USER.md`：全局用户偏好；
- `MEMORY.md`：极短、全局、稳定事实。

它已经会把三者在会话首次 turn 读入并缓存；后续不会自动看到新内容。[SessionRuntime](/Users/ysansan/webProject/ant-chat/packages/backend/src/agent-core/session/SessionRuntime.ts:211) 因此不能继续往里面堆“项目结论、历史任务摘要、证据链”。

新增 `MemoryCatalog`：

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  workspace_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body_path TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  status TEXT NOT NULL, -- pending | active | archived
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  archived_at INTEGER
);

CREATE TABLE memory_evidence (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  PRIMARY KEY(memory_id, message_id)
);
```

关键决策：

- `pending` 可由 agent 提议，但只有用户在 UI 明确批准后才能变为 `active` 并写 Markdown。
- 证据用 `memory_evidence(memory_id, message_id)`，不要只存 `message_start/end`：结论来源往往不连续，单点消息也能精确溯源。
- 删除是 `archived_at` 软删除；文件不删。
- memory 正文只允许 app-managed 相对路径；读取时校验位于 workspace 对应的 memory root。
- `summary` 进 FTS；正文不自动注入 prompt。
- 记忆正文作为“参考信息”，不作为系统指令；渲染进上下文时加固定边界和来源元信息。

接口保持小：

```ts
interface MemoryCatalog {
  search(input: { query: string, workspacePath: string, limit?: number }): Promise<MemoryHit[]>
  propose(input: MemoryProposal): Promise<PendingMemory>
  approve(input: { memoryId: string }): Promise<MemoryRecord>
  archive(input: { memoryId: string }): Promise<void>
}
```

Agent 可用的能力应是：

- `search_messages`
- `get_thread`
- `get_turn`
- `search_memories`
- `propose_memory`

不应保留当前 agent 直接写长期记忆的能力。现在的 `memory` tool 可直接编辑 `USER/MEMORY.md`，这与"人工批准后才生效"冲突。[ToolRegistry](/Users/ysansan/webProject/ant-chat/packages/backend/src/agent-core/tools/toolRegistry.ts:271) 建议把它收窄为仅用户确认后的 UI 操作；如果兼容性必须保留，至少不让它写新的 `MemoryCatalog`。

`propose_memory` 在自动化 turn 中自动拒绝：automations 有 `permission_policy` 字段（[schema](packages/backend/src/data/sqlite/schema.ts:67)），tool 执行层根据 turn 来源判断——当 turn 由 automation 触发时，`propose_memory` 直接返回拒绝结果，不创建 pending 记录。`approve` 始终只允许用户在 UI 操作，agent 无权调用。

## 注入策略

V1 不做自动召回注入。检索结果只通过显式 tool 返回，agent 自己决定是否继续 `getThread/getTurn` 验证。这样不会污染 `buildConversationContextEntries()` 的 compaction 语义，也不会让过时记忆静默影响每一轮。

V2 如需自动召回，必须由 `SessionRuntime` 在每轮启动时统一完成，设定 workspace filter、结果上限、token budget 与可观测事件；不能让前端或模型自行拼 system prompt。

## 实施顺序

1. 增加 migration：`ordinal`、搜索投影、双 FTS、历史回填。
2. 实现 `MessageSearch` 模块（search/getThread/getTurn），作为 agent tool 后端，不替换前端搜索。
3. 向 Agent registry 暴露 `search_messages`、`get_thread`、`get_turn` 三个只读 tool。
4. 新增 `MemoryCatalog`、批准 UI、Markdown store 与证据回跳。
5. 向 Agent registry 暴露 `search_memories`（只读）和 `propose_memory`（只写 pending，自动化 turn 自动拒绝）。
6. 最后再决定是否做 runtime 自动召回。

验收重点：

- 新增/更新/删除消息后索引一致；
- 英文、CJK 长词、CJK 短词、`%/_` 字面量、tool 参数路径均可预期检索；
- 搜索结果能定位到具体消息；
- compaction 后仍能搜索被压缩的原始证据；
- 未批准 memory 永不参与召回；
- workspace A 的 memory 不会被 workspace B 检索或注入；
- 归档 memory 不再召回但仍可追溯；
- 自动化 turn 不具备创建或批准记忆的权限。
