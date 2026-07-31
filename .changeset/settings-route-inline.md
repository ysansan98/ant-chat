---
"@ant-chat/shared": patch
"@ant-chat/desktop": patch
"@ant-chat/web": patch
---

桌面端移除独立的设置窗口：设置页并入主窗口，通过 `/settings` 路由进入；侧边栏入口、macOS 应用菜单（Cmd+,）与「返回工作区」均改为窗口内路由跳转。
