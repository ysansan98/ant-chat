---
"@ant-chat/desktop": patch
---

开发环境 Windows/Linux 同样隐藏原生菜单栏（与生产环境行为一致）；Ctrl+R 刷新、Ctrl+Shift+I DevTools、Ctrl+Q 退出等 dev 快捷键由 before-input-event 兜底，不受影响。macOS 保留应用菜单（Cmd+C/V 等依赖 role 加速器）。
