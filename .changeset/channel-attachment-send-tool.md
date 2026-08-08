---
"ant-chat": minor
"@ant-chat/backend": minor
"@ant-chat/shared": minor
---

消息频道出站附件：微信 iLink 与飞书支持发送文件/图片/文档。频道会话中 agent 通过 `send_attachment` 工具直接把工作区文件发送到当前会话并返回真实消息 ID，发送失败会反馈给模型；桌面会话则作为附件附加到回复。
