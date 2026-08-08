---
'ant-chat': patch
'@ant-chat/desktop': patch
---

消息频道 /steer 有运行任务时注入下一个迭代

- 频道 `/steer` 与 UI 追加指令（`agent.injectSteering`）语义对齐：存在运行/等待审批任务时，把指令注入当前任务的下一个迭代；无任务时落库，由下一轮 startTurn 作为历史追加。
- 回复文案按实际结果区分：「已注入当前任务。」/「当前没有运行中的任务，指令已记录，下次任务开始时生效。」
