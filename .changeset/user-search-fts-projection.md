---
"@ant-chat/backend": patch
---

用户全局消息搜索改走 FTS trigram 投影，在保留子串匹配语义的同时避免解析消息 JSON。
