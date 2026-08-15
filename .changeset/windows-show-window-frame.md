---
'@ant-chat/desktop': patch
---

Windows 下显示原生窗口边框

- 移除 Windows 无边框窗口特殊处理（`frame: false`），Windows 窗口恢复标准标题栏与最小化/最大化/关闭按钮；macOS 保持隐藏标题栏 + 红绿灯按钮设计不变
