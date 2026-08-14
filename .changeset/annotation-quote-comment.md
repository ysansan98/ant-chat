---
'ant-chat': minor
'@ant-chat/backend': minor
'@ant-chat/shared': minor
'@ant-chat/web': minor
'@ant-chat/desktop': patch
---

模型回复批注：支持对模型回复选中文本添加批注（引用 + 评论），随用户消息发送给模型

- 发送前编辑态：选区批注、序号气泡、点击复现高亮、编辑/删除（临时状态，不落库）
- 发送：批注组装为 `annotation` blocks 随用户消息落库，上下文渲染为 `<annotation><quote>/<comment>` 结构化文本注入模型
- 发送后展示：用户消息渲染"n条注释"按钮 + hover 列表；Sender 输入框上方预览，可跳转回引用消息原位编辑
- 消息内容新增 `annotation` block 类型（schema 扩展，无数据库迁移）
