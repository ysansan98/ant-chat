---
'ant-chat': patch
'@ant-chat/shared': patch
'@ant-chat/web': patch
'@ant-chat/desktop': patch
---

系统通知：应用失焦时 turn 执行完成发送系统级通知（Web 与桌面端均支持），点击通知聚焦应用并跳转到对应会话页

- 渲染层新增 `useTurnFinishedNotification`：监听 `agent:turn-finished`，仅当应用失焦（`document.hasFocus()` 为 false）时通过系统 Notification 提醒，success/error 均通知、cancel 不通知；同一会话的通知互斥替换（tag）。
- Web 端在首次用户交互时申请 Notification 权限，未授权时发送前再补一次申请。
- 桌面端新增 `app.focusWindow` IPC：点击通知时主进程恢复最小化/隐藏窗口并聚焦；路由跳转到 `/chat` 并激活对应会话（含跨工作区）。