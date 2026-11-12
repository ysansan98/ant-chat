---
"@ant-chat/backend": patch
---

修复后台命令读取日志时可能在异步写入落盘前读到旧内容的问题：read_command_output 在取日志大小前等待已排队的写入完成，命令结束时也等待 writeStream 正常关闭。
