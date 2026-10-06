---
'@ant-chat/shared': minor
'@ant-chat/backend': minor
'@ant-chat/web': minor
'ant-chat': minor
---

支持会话级后台命令执行（P1 全范围）：

- `execute_command` 新增 `runInBackground`：命令在会话级 `BackgroundCommandManager` 中运行并跨 turn 存活；后台模式忽略默认 10s 超时，显式 `timeoutMs` 降级为看门狗。
- 新增三个工具：`read_command_output`（按字节 offset 增量读取、`waitMs` 有界等待）、`kill_command`（终止进程组，SIGTERM → 1s 宽限 → SIGKILL）、`list_commands`。
- 日志落盘 `<appDataRoot>/commands/logs/<commandId>.log`，合并 stdout/stderr、20MB 上限截断、密钥按块流式脱敏；会话关闭与 Runtime dispose 回收进程，App 启动时扫描状态文件按命令指纹回收孤儿进程组。
- agent 感知：命令结束（自然退出 / 用户终止 / 看门狗超时）进入会话通知队列。Turn 运行中在每轮模型调用前注入 `<background_command_notices>` 上下文；Turn 之间在下一次 systemPrompt 呈现一次，不自动唤醒新 turn。agent 自己发起的 `kill_command` 与会话关闭 / 应用退出不回队；agent 已通过 `read_command_output` 读到终态时通知被消费。
- 会话级 RPC 与事件：`agent.listBackgroundCommands` / `agent.killBackgroundCommand` / `agent.readBackgroundCommandOutput` 与 `agent:background-commands-updated`；Sender 新增后台命令面板（横向胶囊组 + 悬停日志与终止）。
- 后台命令与前台共用同一风险判定与审批路径；持有 Turn 密钥的后台进程在日志头部、工具结果与 UI 中标注审计。
