---
'ant-chat': patch
'@ant-chat/desktop': patch
---

修复消息跳转导航（消息列表右侧的圆点 rail）定位：改为锚定消息列表容器而非视口，右侧栏展开后不再被压在侧栏上，并随侧栏伸缩同步移动。
