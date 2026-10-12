---
'ant-chat': patch
'@ant-chat/web': patch
'@ant-chat/desktop': patch
---

新建对话入口图标由铅笔改为 MessageCirclePlus：

- 侧边栏「新对话」、侧边栏收起后的浮动入口、移动端顶栏新建按钮统一使用 `MessageCirclePlus`（web 渲染层，桌面端复用同一渲染层）。
