---
"ant-chat": patch
"@ant-chat/desktop": patch
---

修复 `/fork` 复制会话时消息数据顺序错乱：复制消息现在保留源消息 `created_at`，fork 事件消息改为最后写入，确保新会话消息按源会话时间顺序排列。
