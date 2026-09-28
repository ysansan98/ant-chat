---
'ant-chat': patch
'@ant-chat/backend': patch
'@ant-chat/web': patch
'@ant-chat/desktop': patch
---

修复图像生成的产物交付与开发环境路径：

- 桌面会话中 `send_attachment` 的附件此前只写入消息、不参与渲染：助手消息 content 里的图片/文档/文件附件块现在在回复中原位展示（图片走缩略图与全屏预览、文档/文件走卡片），不再静默消失。
- `ant-chat image generate` 的 `--output` 相对路径改为按调用者 cwd 解析：开发环境 wrapper 此前把 CLI 进程 cwd 固定在 `packages/ant-chat`，导致缺省 `./generated` 落到包目录而非工作区。
- `GenerationModule` 对非绝对路径的产物目录直接报错，不再静默按后端进程 cwd 解析（后端与调用者 cwd 不同）。
