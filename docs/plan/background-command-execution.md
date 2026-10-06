# 后台命令执行：设计与决策记录

## 状态

已实现（2026-10-05）。P1 全部范围落地：会话级 `BackgroundCommandManager`、`execute_command.runInBackground` 与 `read_command_output` / `kill_command` / `list_commands`、日志落盘与大小上限、生命周期清理与孤儿扫描、会话级 RPC/事件与 UI 终止入口。

实现与原设计的差异：

- 脱敏改为**流式脱敏器**：仅当块尾恰好是某个密钥的前缀时才暂留，普通文本不因等待而延迟输出。
- 日志大小上限可通过 manager 选项注入（默认 20MB），便于单测覆盖 `truncated` 行为。
- Windows 孤儿回收只清理状态文件（`ps` 探针在 Windows 返回 null），与「Windows Job Object 留待真正需要时再评估」一致。
- **agent 感知（原设计缺口）**：manager 维护每会话的结束通知队列。
  - Turn 运行中：`agentLoop` 每轮模型调用前 drain 并注入一条带「不是用户消息」标注的上下文（不落库、不显示、不额外开 turn）。
  - Turn 之间：残留通知在下一次 `prepareTask` 时拼进 systemPrompt 呈现一次，**不自动唤醒新 turn**（避免替用户烧 token）。
  - 降噪：agent 自己 `kill_command` 不回队；会话关闭 / 应用退出不回队；每会话队列上限 50 条，单轮最多呈现 20 条。
  - 参考：Claude Code 采用「无条件注入 + 唤醒 idle」，社区反馈 token 浪费与 reminder 残留；Codex 在 idle 时直接丢弃退出事件。本实现取两者之间。

## 背景

### 现状

命令能力只有一个原生工具 `execute_command`（[commandTool.ts](../../packages/backend/src/agent-core/native-tools/command/commandTool.ts)），执行路径是**阻塞式**的：

- `runPreparedCommand` 用 `spawn` 启动，等 `close`（或 `exit` 后 200ms 排空）收敛，返回单个 `AgentToolResult`（[commandRunner.ts:26](../../packages/backend/src/agent-core/native-tools/command/commandRunner.ts#L26)）。
- 默认超时 10s（`DEFAULT_TIMEOUT_MS`），超时或 abort 都会对**整个进程组**发 SIGTERM，随后补 SIGKILL。
- 输出全量收集在内存，超过 20k 字符截断（`MAX_OUTPUT_CHARS`）。
- 工具实例每个 turn 由 `ToolRegistry.create` 重建，**没有跨 turn 的状态容器**（[toolRegistry.ts:56](../../packages/backend/src/agent-core/tools/toolRegistry.ts#L56)）。
- abort 信号来自 task 的 `abortController.signal`（[agentLoop.ts:93](../../packages/backend/src/agent-core/loop/agentLoop.ts#L93)）。

### 问题

`pnpm dev`、`vite`、watch、长构建、本地服务、数据库这类**长驻或非阻塞**命令现在跑不了：10s 后被杀，agent 也无法在命令运行期间继续工作、查看日志或按需终止。

## 需求

1. 启动即返回：命令在后台运行，agent 无需阻塞等待。
2. 跨 turn 存活：turn/task 结束后进程继续运行，直到显式终止或会话结束。
3. 增量读取输出：agent 可反复查看新增 stdout/stderr，不重复读取全量。
4. 显式终止：agent 与**用户都能**终止指定后台命令。
5. 会话隔离：一个会话不能读取或终止另一个会话的后台命令。
6. 生命周期清理：正常退出、会话关闭、Runtime dispose 时回收；异常崩溃有兜底。

## 非目标

- **常驻 shell / 交互式 stdin**：目标场景（dev server/watch、长构建/测试）不需要，且与现有静态命令审批模型存在根本冲突（见「为什么不做常驻 shell」）。
- **一次性 stdin 参数**：同属交互式范畴，无实际场景，不纳入。
- **命令记录落库**：历史命令已随 `execute_command` 的 tool-result 消息入库，落库属重复存储（见「为什么不做持久化」）。
- `wrapper 进程 + 继承管道`的强孤儿防护：P1 用启动扫描兜底；Windows Job Object 留待真正需要时再评估。

## 已确认的决策

| # | 决策 | 来源 |
|---|---|---|
| D1 | 进程生命周期为**会话级**：turn/task 结束不终止，直到显式 kill、会话关闭或 App 退出 | 用户确认 |
| D2 | 取消任务**不**终止后台命令；由 agent/用户显式结束 | 用户确认 |
| D3 | 工具形态：扩展 `execute_command` + 配套 `read_command_output` / `kill_command` / `list_commands` | 用户确认 |
| D4 | 后台运行 + `secretEnv` 允许，但记录与 UI 中**标注审计**（该进程持有 Turn 密钥） | 用户确认 |
| D5 | 输出直接**写入日志文件**；agent 读取即读该文件（增量 offset），不做内存环形缓冲 | 用户确认 |
| D6 | 日志放在**应用数据目录** `<appDataRoot>/commands/`，agent 通过 `read_command_output` 读（不穿工作区 pathPolicy，仅会话归属校验） | 用户确认 |
| D7 | UI 提供手动终止入口：RPC + 事件推送，命令列表为**内存态**（App 重启后清空，日志文件仍在） | 用户确认 |
| D11 | 会话级主入口位于 **SenderComposer 内、待处理消息队列上方**；面板内可直接查看日志（新增读日志 RPC） | 用户确认 |
| D12 | 面板形态为**横向胶囊组**，hover 胶囊在**上方**弹出日志与终止操作 | 用户确认 |
| D8 | 自动化 turn **默认允许**后台命令，受该 turn 的 `permissionPolicy` 约束 | 用户确认 |
| D9 | 退出清理：正常退出与信号可 kill；SIGKILL/崩溃靠**启动时扫描状态文件**兜底 | 用户确认 |
| D10 | **范围锁定为独立进程方案**（P1）。用户实际场景为 dev server/watch 与长构建/测试，不涉及交互式 stdin、跨命令 shell 状态保持 | 用户确认 |

## 契约设计

### 1. `execute_command` 扩展

输入新增一个字段，其余不变：

```ts
interface CommandToolInput {
  command: string
  description?: string
  cwd?: string
  timeoutMs?: number
  secretEnv?: Record<string, SecretRef>
  /** 新增：true 时命令在后台运行，工具立即返回 commandId。默认 false。 */
  runInBackground?: boolean
}
```

语义约定：

- `runInBackground` 不影响风险判定：仍走 `prepareBashCommand` / `prepareWindowsCommand` 得到同一 `risk` / `resourceScope` / `operationType`。
- 后台模式下**忽略默认 10s 超时**；若显式传入 `timeoutMs`，视为看门狗（运行满该时长后自动终止）；不传则不限时长。
- 返回：`diagnostics: { commandId, pid, status: 'running', logPath }`，`result` 含 commandId 与首段输出。
- 启动失败（spawn error / 并发上限）：`ok: false`，原因明确。

### 2. `read_command_output`

```ts
interface ReadCommandOutputInput {
  commandId: string
  /** 上次返回的 nextOffset（字节）；省略时从头读。 */
  offset?: number
  /** 单次返回上限（字节），默认 65536，最大 262144。 */
  maxChars?: number
  /** 有界等待：等到有新输出、进程退出或超时三者之一；默认 0，最大 30000。 */
  waitMs?: number
}
```

返回 `diagnostics: { commandId, status: 'running' | 'exited' | 'killed', offset, nextOffset, exitCode?, truncated }`。
`truncated: true` 表示日志已触及大小上限、之后不再增长。

### 3. `kill_command`

```ts
interface KillCommandInput {
  commandId: string
  /** 默认 SIGTERM；SIGKILL 用于无响应进程。 */
  signal?: 'SIGTERM' | 'SIGKILL'
}
```

终止目标进程**组**（复用现有 `terminateProcessTree`），SIGTERM 后 1s 宽限补 SIGKILL。返回终止后的 `status` 与 `exitCode`。

### 4. `list_commands`

返回当前会话的后台命令摘要：`commandId`、命令、状态、pid、启动/结束时间、是否持有 secretEnv、日志路径。让 agent 与新 turn 恢复上下文。

## 架构

### 归属：会话级 Manager

新增 `BackgroundCommandManager`，由 `SessionRuntime` 持有，与现有 `BrowserSessionManager` 同构（[SessionRuntime.ts:46](../../packages/backend/src/agent-core/session/SessionRuntime.ts#L46)）：

- `SessionRuntime` 是 per-conversation 的，`closeConversation` / `dispose` 已有清理钩子。
- `prepareTask` 内调用 `ToolRegistry.create` 时能拿到 `conversation.id`，把 manager 实例与 `conversationId` 透传下去。

```
SessionRuntime
  ├── BackgroundCommandManager（新，per-conversation）
  └── prepareTask → ToolRegistry.create({ backgroundCommands, conversationId })
        → getNativeToolService(...)
        → createCommandTool(...) 持有 manager 引用
              ├── execute_command(runInBackground) → manager.start()
              ├── read_command_output              → manager.readLog()
              ├── kill_command                     → manager.kill()
              └── list_commands                    → manager.list()
```

工具实例仍是 per-turn，但 manager 是跨 turn 的会话级实例，后台进程因此天然跨 turn 存活。

### 关键 API

```ts
class BackgroundCommandManager {
  start(conversationId: string, prepared: PreparedCommandState, opts: StartOptions): StartResult
  read(conversationId: string, commandId: string, opts: ReadOptions): Promise<ReadResult>
  kill(conversationId: string, commandId: string, signal?: NodeJS.Signals): Promise<KillResult>
  list(conversationId: string): CommandSummary[]
  closeConversation(conversationId: string): Promise<void>
  dispose(): Promise<void>
}
```

- 所有方法先按 `conversationId` 校验归属，跨会话访问直接拒绝（不泄露是否存在）。
- `StartOptions` 携带 `secretEnv`（已解析的值）、`spawnProcess`（测试注入）。**不绑定** turn 的 abortSignal（D2）。

### 输出模型（D5/D6）

与阻塞式执行最本质的差异是必须**持续消费管道**，否则 dev server 输出撑满 ~64KB pipe 缓冲后会被背压挂起：

- 启动时创建日志文件 `<appDataRoot>/commands/logs/<commandId>.log`，写入头部（命令、cwd、pid、secretEnv 审计标记）。
- `stdout` / `stderr` 分别监听 `data`，原样追加到同一文件（合并为终端式日志），不做内存缓冲。
- **文件大小上限 20MB**：达到后停止写入，末尾追加 `[output truncated: limit reached]`，后续 read 返回 `truncated: true`。防止长驻进程占满磁盘。
- `read_command_output` 直接按字节 offset 读文件（`fs.open` + `read`），返回 `nextOffset`，天然支持增量与跨 turn。
- `waitMs > 0` 时挂在「文件出现新数据 / 进程退出 / 超时」三者之一上返回。

### 路径

照现有 `createAgentBrowserPaths`（[agentBrowser.ts:15](../../packages/backend/src/agentBrowser.ts#L15)）的模式新增：

```ts
createAgentCommandPaths(appDataRoot) → {
  root:        <appDataRoot>/commands
  logsPath:    <appDataRoot>/commands/logs
  statePath:   <appDataRoot>/commands/state
}
```

默认 `appDataRoot` 为 `~/.ant-chat`，与浏览器产物同源。

### 错误与边界

- 并发上限：每会话默认 8 个活跃后台命令，超出返回明确错误（不排队）。
- 进程退出后记录**保留到会话结束**，日志仍可读；同会话内 commandId 单调递增。
- 只按 commandId 索引，不按 pid 反查。

## 安全与审批

- **风险判定不变**：后台命令复用同一 `prepare` 路径，`risk` / `resourceScope` / `operationType` 与前台一致；`requires_approval` 与 `bottomline_block` 行为不变（[toolAuthorization.ts:44](../../packages/backend/src/agent-core/policy/toolAuthorization.ts#L44)）。
- **`read_command_output`**：`operationType: 'command_read'`，`inferScope` 返回对应命令的 scope（未找到则 `blocked`）。读日志不穿工作区 pathPolicy，但受会话归属校验。
- **`kill_command`**：`operationType: 'command'`，scope 由命令记录推导；只能终止本会话启动的命令。
- **D4 审计**：命令记录标记 `secretEnvKeys` 与 `hasSecretEnv`，在 `list_commands`、工具结果、日志头部、UI 中标注「该后台进程持有 Turn 密钥」。输出仍按现有 `redactSecrets` 逻辑脱敏后再写文件（用启动时解析出的值替换为 `[secret]`），保证跨 turn 读取也安全。
- **自动化 turn**：默认允许（D8），受该 turn `permissionPolicy` 的命令权限约束；policy 拒绝命令时后台启动同样被拒。

## UI 手动终止（D7 / D11）

命令列表为**内存态**，App 重启后清空；UI 通过事件 + RPC 双通道同步。

**后端暴露**（复用现有链路：`IAgentEventEmitter` → `AgentModule` → [ipc-events.ts](../../packages/shared/src/ipc-events.ts) → 前端 `useAppEventListener`）：

- 事件 `agent:background-commands-updated`：payload `{ conversationId, commands: BackgroundCommandSummary[] }`，启动/退出/终止时推送全量快照（列表规模小，避免增量合并复杂度）。
- RPC `agent.listBackgroundCommands`：`{ conversationId }` → `BackgroundCommandSummary[]`，用于首次加载与重连补齐。
- RPC `agent.killBackgroundCommand`：`{ conversationId, commandId, signal? }` → `BackgroundCommandSummary | null`。属用户直接操作，不经 agent 审批，RPC 层校验会话归属。
- RPC `agent.readBackgroundCommandOutput`：`{ conversationId, commandId, offset?, maxChars?, tail? }` → `{ text, nextOffset, status, exitCode?, truncated }`。复用 manager 的文件 offset 读取；`tail` 读最后 N 字节，供 UI 直接看尾部。

**位置（D11）**：新增 `BackgroundCommandPanel`，放在 [SenderComposer.tsx](../../apps/web/src/components/Sender/SenderComposer.tsx) 中 `PendingMessageQueue` **之前**，与队列同处 composer 卡片内。无命令时 `return null`，不占位。

**形态（D12）**：**横向胶囊组**，`flex flex-wrap gap-1` 排列，每个后台任务一个胶囊：

- 胶囊内容：状态点（running 脉动 / exited 灰 / killed 红）+ 命令名（截断，优先 `description`）+ 运行中已结束的退出码；
- 超出 N 个时折叠为 `+N`，点击展开全部；
- 任务多时占不超过两行高度，不长期顶高输入区；
- 视觉上与队列区分（胶囊形态天然区别于队列的整行条目）。

**Hover 日志**：用现有 [hover-card.tsx](../../packages/ui/src/components/hover-card.tsx)（base-ui `PreviewCard`，支持 `side="top"`），hover 胶囊时在其**上方**弹出日志面板：

- 内容：日志尾部（等宽字体、限高滚动）+ 命令全文、cwd、pid、状态、时长、退出码、密钥审计标记（D4）；
- 数据：打开时调用 `readBackgroundCommandOutput({ tail })`；面板保持打开且进程仍 running 时每 1s 刷新；
- 「终止」按钮放在 HoverCard 内（不在胶囊上），避免误触；触屏等 hover 不可用场景降级为点击胶囊打开。

**就近可见性**：tool-call 卡片复用现有 `isExecuting` 判定（[turnSteps.ts](../../apps/web/src/components/Chat/turnSteps.ts)）显示「运行中」徽标；进程退出事件到达后收口为「已完成」。

**前端数据流**：

- 投影：`useAppEventListener` 订阅 `agent:background-commands-updated` → `applyBackgroundCommandsSnapshot`（[useAppEventListener.ts](../../apps/web/src/hooks/useAppEventListener.ts)），存入 `store/agentRuntime`（新增 `backgroundCommandsByConversation`）。
- 补齐：打开会话时调用 `agentApi.listBackgroundCommands(conversationId)`。
- tool-call 卡片复用现有 `isExecuting` 判定（[turnSteps.ts](../../apps/web/src/components/Chat/turnSteps.ts)）显示「运行中」徽标；进程退出事件到达后收口为「已完成」。


## 生命周期（D9）

| 事件 | 行为 |
|---|---|
| turn 结束 / 用户取消任务 | 后台进程继续运行（D1/D2） |
| `kill_command` 或 UI 终止 | 终止目标进程组，SIGTERM → 1s → SIGKILL |
| 会话关闭/归档 | `closeConversation` 终止该会话全部后台进程 |
| App 正常退出 / Runtime dispose | `before-quit` 钩子内终止全部后台进程组，并清理状态文件 |
| SIGTERM / SIGINT | 注册信号处理器，终止全部后台进程组 |
| SIGKILL / OOM / 主进程崩溃 | 用户态无执行机会，**无法清理**；由启动扫描兜底 |
| App 下次启动 | 扫描 `statePath` 残留记录，逐项校验后回收（见下） |

**孤儿兜底**：启动后台命令时写 `<statePath>/<commandId>.json`（`{ pgid, pid, commandId, startedAt, commandFingerprint }`），正常结束时删除。App 启动时扫描残留：

- 校验进程存在、启动时间匹配、命令指纹匹配（防 pid 复用）后才对进程组发 SIGTERM/SIGKILL；
- 校验不通过只删除状态文件，不 kill；
- 状态文件的写入/删除都是 best-effort，失败只记日志，不阻断命令启动。

实现注意：现有 `terminateProcessTree` 是 [commandRunner.ts:150](../../packages/backend/src/agent-core/native-tools/command/commandRunner.ts#L150) 内部函数，应抽取为共享模块供 manager 与前台执行复用；POSIX 用 `detached` 建立进程组（现有做法），Windows 用 `taskkill /T /F`。

## 测试计划

- **Manager 单测**（注入 fake spawn + 临时目录）：启动即返回；日志文件写入；增量 read 的 offset/nextOffset；`waitMs` 等待语义；进程退出后读尾部；20MB 上限触发 `truncated`；kill 走 SIGTERM→SIGKILL；并发上限拒绝；跨会话访问被拒；`closeConversation` / `dispose` 回收；状态文件写入与删除。
- **孤儿扫描单测**：残留记录校验通过则 kill、pid 复用/指纹不符则只清记录。
- **命令契约**：`runInBackground` 输入校验；后台模式忽略默认超时、显式 `timeoutMs` 作为看门狗。
- **集成**：turn 结束后进程仍存活且新 turn 可读输出；cancelTask 不杀后台进程；dispose 杀。
- **安全**：后台命令 risk/scope 与前台一致；secretEnv 输出 redact；审计标记存在。
- **RPC/事件**：list/kill 的会话归属校验；事件在启动、退出、终止时推送。
- **前端**：新工具名 toolDisplay 文案；胶囊组渲染与 `+N` 折叠；HoverCard 打开触发 `readBackgroundCommandOutput`、running 时刷新；HoverCard 内终止；tool-call 状态收口。

## 分期

**P1 即全部范围**：Manager + `execute_command.runInBackground` + `read_command_output` + `kill_command` + `list_commands` + 日志落盘与上限 + 生命周期清理 + 孤儿扫描 + 审计标注 + 会话级 RPC/事件 + UI 终止入口 + 测试。

## 为什么不做常驻 shell

同类产品的两条路线：

| 产品 | 形态 | 对应我们的 |
|---|---|---|
| Claude Code | `Bash(run_in_background)` + `BashOutput` + `KillShell`，每条命令独立进程 | P1（本方案） |
| Codex | `unified_exec`：`exec_command` + `write_stdin`，session 为**单个进程**句柄，可多次写 stdin / 轮询 | 明确不做 |

Codex 官方源码证据（一手）：

- `codex-rs/core/src/shell.rs` 的 `derive_exec_args` 生成 `bash -c "cmd"`（或 `-lc`）→ 每条 `exec_command` 都是新 shell 进程，`cd` 不跨命令保持，换目录靠独立的 `workdir` 参数。
- `codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs` 中 `process_id: args.session_id` → session 指向单个进程，不是共享 shell 状态；空写为后台轮询，非空写继续一条已跑过 Bash 审批的命令。
- 未验证项：`UnifiedExecShellMode::ZshFork` 分支的具体实现未逐行核对，但其 fork 出的子进程执行完即退出、cwd 不回传，推断不改变上述结论。

**不做的根本原因不是实现成本，而是权限模型冲突**：ant-chat 的审批在 `prepare` 阶段静态解析命令文本得出 `risk` / `resourceScope`（[commandTool.ts:45](../../packages/backend/src/agent-core/native-tools/command/commandTool.ts#L45) → `prepareBashCommand` → `bashCommandParser`）。常驻 shell 的真实命令是 `write_stdin` 运行时才写入的字符串，且依赖前序命令的 shell 状态，无法在写入前完成静态分析——采用它意味着放弃审批或重做一套"逐行解析 + shell 状态机"的权限系统。

**重新评估的触发条件**：出现没有它就不行的真实场景（如 sudo/ssh 需要真 PTY、REPL 连续会话、必须跨命令保持 `cd`/`export`）。届时先设计权限模型，再动工；即使实现，也应作为独立能力，而不是改掉 P1 的独立进程语义。

## 为什么不做命令记录持久化

`execute_command` 的 tool-result 会作为 `role: 'tool'` 消息进入会话历史并落库（[agentLoop.ts:262](../../packages/backend/src/agent-core/loop/agentLoop.ts#L262)），因此"某会话启动过哪些命令"事后可查，落库属于重复存储。

命令记录（内存 manager）解决的是另一个问题：**实时状态**。tool-result 是启动那一刻的快照，进程后续退出、退出码、被 kill 都不会回写那条消息；而 UI 实时列表、kill 归属校验、并发上限需要一份权威的活跃表。App 重启后该表清空，但日志文件仍在磁盘，历史消息仍可回顾，因此无需持久化（D7）。

若将来出现"跨重启按会话列出历史后台命令及其退出码"的真实需求，再考虑落库。

