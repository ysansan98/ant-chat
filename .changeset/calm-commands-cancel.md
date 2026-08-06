---
"@ant-chat/backend": patch
---

修复取消 turn 无法中断执行中的 `execute_command`：命令 runner 接入 AbortSignal，取消/超时向整个进程组发送 SIGTERM 并在宽限后补 SIGKILL；Promise 不再依赖 `close` 事件，命令自然退出但孙进程持有管道时也会立即收尾；取消时补写 tool-call 终态与 cancelled tool-result，turn 立即进入终态；不再静默把模型请求的 `timeoutMs` cap 到 30 秒。
