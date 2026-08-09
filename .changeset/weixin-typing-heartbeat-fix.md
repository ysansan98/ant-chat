---
"@ant-chat/backend": patch
---

修复微信频道 typing 心跳不生效：心跳改为通过 connector 实例调用 `setTyping`（此前解构方法调用丢失 `this`，导致每个 tick 都在读取 `this.state` 时抛错，微信端"对方正在输入"从未持续显示）。turn 全程每 2s 续发心跳，终态停止并发送关闭信号，中间审批不中断。
