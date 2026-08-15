---
'@ant-chat/backend': patch
'@ant-chat/desktop': patch
---

修复 Windows 下控制管道名固定导致 dev 与 prod（或不同数据目录）实例同时运行时 EADDRINUSE 冲突：管道名改为按数据根派生，与 macOS/Linux 的 socket 文件隔离行为对齐。
