---
'@ant-chat/backend': minor
'@ant-chat/shared': minor
'@ant-chat/web': minor
---

Agent 消息搜索与人工批准的长期记忆目录（MemoryCatalog）

- 新增 migration v9：`messages.ordinal`（会话内稳定排序键）、`message_search_documents` / `message_tool_facts` 搜索投影、`messages_fts_unicode` / `messages_fts_trigram` 双 FTS（trigram 不可用时显式降级为 LIKE）、`memories` / `memory_evidence` 长期记忆表。
- 新增 Agent 专用消息搜索后端（`search_messages` / `get_thread` / `get_turn` 三个只读工具）：英文/路径走 unicode61、CJK ≥3 字走 trigram、1–2 字走转义 LIKE；`search_messages` 支持 `tool_name` / `server_name` 精确过滤（基于 `message_tool_facts` 结构化事实）；`get_turn` 返回本 turn 用户根消息、同 turn 消息与关联 compaction boundary。
- 新增 `search_memories` / `propose_memory` 工具：记忆由 agent 提议（pending），仅用户在 UI 批准后生效并写入 `app-data/memories/<workspace-key>/`；自动化 turn 无权提议或批准。
- 恢复 agent 主动维护全局记忆快照的 `memory` 工具（USER.md / MEMORY.md，仅交互式 turn；automation 无权）；需人工批准的项目结论仍走 `propose_memory`（MemoryCatalog）。
- 新增「长期记忆」设置页：待批准/已批准/已归档三个视图，支持批准、归档、查看正文与证据回跳（跳转到对应会话消息）。
- 前端 `search.searchByKeyword` RPC 与 `messages` 表语义保持不变。
