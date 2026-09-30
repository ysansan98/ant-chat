# 待处理消息队列后端化：需求与决策记录

## 状态

已实现（2026-09-29）。队列已下沉到后端 runtime：服务端存储、RPC、事件推送、任务终态接力、引导原子出队均已落地；客户端（Desktop / Web 共享渲染层）转为纯投影。本文保留原始需求与决策记录，并在文末补充实现定案。

## 背景

### 现状

队列当前完全实现在渲染层 `apps/web/src/store/pendingMessages/`（zustand + localStorage 持久化）：

- 任务运行中提交的用户消息默认入队、不打断当前任务；
- 任务进入终态（非 `cancelled`）时，前端在 `agent:task-updated` 事件中排空队列，逐条作为新一轮发出；
- 队列项支持查看、编辑、删除与手动「引导」。

「引导」（steering）是与排队并列的显式动作：把消息立即注入当前运行任务的下一个迭代，跳过排队。desktop 的入口是队列项上的按钮，channel 的入口是 `/steer` 指令；两者共用后端 `agent.injectSteering`。

后端现状：

- 已有：注入管道（`SessionRuntime.injectSteering` → TaskStore 的 steering 双队列 → agent loop 下一个迭代注入）、任务快照事件（`agent:task-updated`）、单任务约束（会话已有活跃任务时 `TaskStore.reserve` 抛 `AGENT_TASK_ALREADY_RUNNING`）。
- 没有：会话级队列存储、队列管理 RPC、任务终态自动接力、队列变更事件。

### 问题

队列语义是产品 runtime 的能力，但实现完全在前端：

- 每新增一个客户端形态（TUI、未来的其他入口）都要重新实现一遍队列状态机；
- 持久化落在各端 localStorage，与后端数据不一致，也无法多端共享；
- 前端还要自行实现队列的串行化、删除屏障、失败回滚等并发语义。

## 需求

把待处理消息队列下沉到后端，作为 runtime 的一等能力：

1. 入队：任务运行中提交的用户消息由后端接收并暂存；
2. 持久化：服务器侧存储，替代 localStorage；
3. 管理：查看 / 编辑 / 删除队列项；
4. 引导：显式把消息注入当前运行任务的下一个迭代（复用现有 `agent.injectSteering`）；
5. 接力：任务终态时自动把队列消息作为新一轮发出；
6. 同步：队列变更事件推送给所有客户端。

客户端（Desktop / Web / TUI / channel）只做展示与交互投影，不再各自实现队列状态机。

## 已确认的决策

| # | 决策 | 来源 | 备注 |
|---|---|---|---|
| D1 | 队列下沉到后端 | 用户明确要求 | 动机：多客户端复用（TUI 等）；队列是运行时能力而非 UI 实现 |
| D2 | 接力节奏维持现状 | 用户批注 | 逐条发送，每条消息等一个完整任务周期 |
| D3 | 引导失败回滚到队列 | 用户批注 | 注入失败时消息保留在队列，不丢失 |
| D4 | channel 普通消息与 desktop 对齐（运行中进队列） | 用户预期，方向确认 | 现状为运行中直接失败，见「核实记录」；`/steer` 的立即注入语义不变 |
| D5 | 可视化表单提交按普通用户输入处理 | 用户明确 | 移除 `next-turn` 特殊标记；运行中提交与其他消息一样入队、可引导；实现时须同步修改 visualize skill 中「不注入当前运行 turn」的承诺文案 |

## 核实记录（决策依据）

### 任务运行中消息的现行行为

| 入口 | 运行中提交 | 显式引导 |
|---|---|---|
| Desktop / Web 输入框 | 入前端队列，可引导（`delivery: 'steering'`） | 队列项「引导」按钮 → `agent.injectSteering` |
| channel 普通消息 | `startTurn` 直接失败（`AGENT_TASK_ALREADY_RUNNING`），用户收到错误回复 | — |
| channel `/steer` | 有活跃任务 → 注入当前任务下一个迭代；无任务 → 落库等待下一轮（被动，不主动发起） | 同左 |

补充：运行中提交的附件 / 工作区引用 / 技能引用消息当前不支持入队，直接报错。

### 可视化表单提交

**决策（D5）**：表单提交按一次普通用户输入处理——表单的目的是降低输入成本，提交即普通发送，不再有 `next-turn` 特殊标记。

现状（将随 D5 调整）：

- 提交内容就是普通文本消息（无专属消息类型），与 Sender 发送共用 `submitTurnIntake` 入口；
- 现状语义由 visualize skill 定义：表单提交只代表创建下一轮 user message，不注入当前正在运行的 turn（`packages/backend/builtin-skills/visualize/SKILL.md`；`ca92705c` 引入时的 skill 即写明「表单提交只代表创建下一轮 user message」，测试断言「运行中只入队且不会调用 steering」「queue 项手动点击也不会注入当前任务」）；该承诺的实现机制即 `delivery: 'next-turn'`；
- 任务空闲时直接 `startTurn`，与普通消息一致；任务运行中：进同一队列且不可引导（`next-turn`）；
- 渲染时机：可视化 block 在 `publish_visualization` 工具执行时即进入消息并推送前端渲染（`persistedTurn.ts` 的 `emitTurnToolCalls`），**不限于 turn 结束**——「提交时任务仍在运行」是可命中分支。

D5 的连带影响：

- 运行中提交的表单内容与其他消息一致：入队、可引导（可注入当前任务下一个迭代）；
- 实现时须同步修改 visualize skill 中「不注入当前运行的 turn」的承诺文案；
- `delivery` 不再需要 `steering` / `next-turn` 分叉，下沉设计按单一投递语义处理。

## 复用与新建（后端）

- 复用：`agent.injectSteering`（引导注入）、`startTurn`（接力）、任务快照事件（接力触发源）、单任务约束。
- 新建：队列存储与持久化、入队 / 查询 / 编辑 / 删除 / 引导 RPC、任务终态接力逻辑、队列变更事件推送。

## 客户端接口面（下沉的必然影响）

队列状态移到后端后，客户端需要完整的「读 + 写 + 同步」接口；传输通道全部复用现状，无需新建：

- 命令面（客户端 → 后端 RPC）：队列快照拉取（连接 / 重连对账）、编辑、删除、引导（「出队 + 注入」的原子操作，失败回滚见 D3）；「入队」由任务运行中发消息的后端语义自然覆盖，未必单独暴露 RPC。
- 事件面（后端 → 客户端）：新增一个队列变更事件（建议携带会话级快照），广播入队 / 编辑 / 删除 / 引导出队 / 接力发出 / 失败回滚等变化。必须用事件而不是只靠命令响应：多端同开、接力（drain）不是客户端触发、异步回滚都需要服务器主动通知。
- 通道复用：事件在 `AppRendererEvents` 与 `APP_RENDERER_EVENT_NAMES` 登记即生效（Web 走 SSE 广播，Electron 走 IPC 转发，均按白名单循环监听）；客户端订阅用现有 `getAppEventSubscriptions`。
- TUI / CLI 消费面 = 上述 RPC + 事件订阅，无需重写队列状态机。

随之明确的客户端侧改造（实现范围）：

- `pendingMessages` store 从状态真相变为后端投影：操作走 RPC，本地乐观更新 + 事件对账（参考 messages store 消费 `message:updated` 的投影模式）；
- 前端并发机制退役：`operationPromises` / `deletionBarriers` / drain 调度等由后端承担，避免双真相漂移；
- 接力决策权转移：任务终态接力（drain → startTurn）在后端执行，前端不再监听 `agent:task-updated` 去发起 startTurn；
- 存量 localStorage 队列数据迁移（见待决事项）。

## 待决事项（设计阶段）

- 队列的数据模型与持久化形式（新表，或扩展 messages 表）；
- 接口面的细节形态（RPC 参数、事件载荷粒度、快照 vs 增量），及无渲染层客户端（TUI / CLI）的消费示例；
- 接力触发点与重启恢复语义：应用重启时队列中残留消息的处理；
- channel 排队回执的文案与用户可见性；
- 存量 localStorage 队列数据的迁移策略。

## 相关历史

- `4b38fd09`（2026-06-11）：后端 steering 注入能力引入；
- `f16d5e2f`（2026-07-01）：前端待处理消息队列引入；
- `ca92705c`：可视化交互运行时，表单 follow-up 引入 `next-turn` 语义（skill 承诺：表单提交只创建下一轮 user message，不注入当前运行 turn）；
- `c8b903c9`（2026-07-16）：`submitTurnIntake` 统一入口重构；
- `d5bb6b02`（2026-08-08）：channel `/steer` 与 UI 引导语义对齐。

## 实现记录（2026-09-29）

### 后端

- 存储：SQLite 新表 `pending_messages`（迁移 v12，`ON DELETE CASCADE` 随会话删除）；接力所需的运行时元数据（mode / userMessageId / turnSource）单独存储，不随协议暴露给客户端。
- 服务：`createPendingMessageService`（查询 / 入队 / 编辑 / 删除 / 引导）；所有变更广播会话级快照，快照带进程内单调 `revision` 供客户端丢弃乱序旧版本。
- 接力：`AgentRuntime` 新增 `onTaskSettled`（任务离开活跃集合后回调，仅 success / failed / cancelled 终态触发）；`AgentModule` 对非 cancelled 任务调用 `turnService.relayPendingMessages`，逐条取队首直接启动（D2），启动失败保留队列项。
- 入队：`startTurn` 在会话有活跃任务时自动转队列（channel 与交互式统一，D4）；频道入站队列化时先持久化 user message，接力复用同一消息。附件 / 工作区引用 / 技能引用仍不支持排队（前端拦截）。
- RPC：`agent.listPendingMessages` / `agent.editPendingMessage` / `agent.removePendingMessage` / `agent.steerPendingMessage`。显式入队 RPC（`agent.enqueuePendingMessage`）随存量迁移一并移除；入队只由 `startTurn` 的运行中语义覆盖。
- 事件：`agent:pending-messages-updated`（会话级快照，Web 走 SSE，Electron 走 IPC 转发，均复用白名单通道）。
- 引导：原子「出队 + 注入」，注入失败保留队列项（D3）。

### 客户端（apps/web，Desktop / Web 共享）

- `pendingMessages` store 改为后端投影：RPC 响应 + 事件按 revision 对账；本地持久化与前端并发状态机（operationPromises / deletionBarriers / drain）全部退役。
- 运行中提交由 `submitTurnIntake` 直接调用 `startTurn`，由后端排队；接力不再由前端触发（`agent:task-updated` 只做投影）。
- 连接 / 切换会话时 `syncPendingMessages` 全量对账（force 应用，兼容服务端 revision 重启重置）。
- 不迁移存量 localStorage 队列（2026-09-30 调整）：原应用启动时的一次性 best-effort 导入已移除，本地旧数据不再导入。
- 可视化表单提交按普通用户输入处理（D5）；`delivery` / `next-turn` 分支移除，visualize skill 文案同步更新。

### 决策定案（原「待决事项」）

| 事项 | 定案 |
|---|---|
| 数据模型与持久化 | 新表 `pending_messages`（见上），text/source/createdAt 面向客户端，mode/userMessageId/turnSource 仅服务端使用 |
| 接口面形态 | 所有队列命令返回与事件均携带完整会话快照 + revision；快照粒度对无渲染层客户端最省心 |
| 接力触发点与重启恢复 | 仅任务终态（非 cancelled）触发；应用重启不自动接力，残留队列等待下一次任务终态或用户手动操作 |
| channel 排队回执 | 「当前任务运行中，消息已排队，将在当前任务结束后处理。」 |
| localStorage 迁移 | 不做迁移；原前端一次性 best-effort 导入逻辑及配套 RPC 已移除 |

### 已知限制

- 接力失败（如模型不可用）只记日志并保留队列项，客户端暂无主动提示；用户可在队列中手动处理。
- cancelled 任务不接力，队列项保留（与下沉前一致）。

### 验证

- `pnpm type-check`、`pnpm lint` 通过；`pnpm test:unit` 在本机有 3 个与本次改动无关的环境性失败（测试直接拼接含空格的 node 路径 `~/Library/Application Support/...`，bash 拆分失败；相关测试文件不在改动范围内）。
- 新增覆盖：pendingMessageService 行为、agentTurnService 排队与接力、AgentRuntime onTaskSettled、迁移 v12、SSE 队列事件、真实链路接力集成测试（真实 sqlite + runtime + 队列）、前端投影 / 队列 UI / GUI 流程。
- Desktop（Electron dev + CDP 操控）真实环境验证通过：
  - 运行中提交第二条消息 → 队列 UI 出现、服务端快照含该条、任务不受打断；
  - 第一条任务终态 → 后端自动接力发出第二条（队列清空、新一轮任务启动、消息进入会话）；
  - 队列项「引导」→ 原子出队并注入当前任务（消息以「追加指令」持久化）。
- 本机真实数据库（`~/.ant-chat-dev`）v12 迁移在 runtime 启动时一次执行成功。
