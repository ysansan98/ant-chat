# Agent Runtime Platform

## 目标架构

Runtime 是核心，UI 是客户端，Electron、Web、CLI 是不同 Host。

```
┌─ UI (React) ────────────────────────────────────┐
│  只消费 RuntimeEvent stream                      │
└────────────┬─────────────────────────────────────┘
             │ Transport (IPC / WebSocket / SSE)
┌────────────▼─────────────────────────────────────┐
│  packages/runtime/                                │
│                                                   │
│  Runtime.ts          ← 组装层，注入 hooks          │
│                                                   │
│  loop/               ← 执行引擎（headless）         │
│    agentLoop         # 模型↔工具多轮循环           │
│    toolExecution     # 单工具执行                  │
│    toolRegistry      # 工具映射                    │
│    compaction        # 上下文压缩                  │
│    loopContext       # 提示词构建                  │
│    taskStore         # 进程内存任务追踪             │
│                                                   │
│  policy/             ← 策略与审批（从 loop 剥离）    │
│  session/            ← 会话编排                    │
│  persistence/        ← DB + JSONL                 │
│  provider/           ← AI Provider 管理            │
│  tools/              ← 工具注册中心                │
│  transport/          ← IPC / WebSocket 适配        │
└───────────────────────────────────────────────────┘
```

**关键原则**：

1. Runtime headless：不依赖 Electron、DOM、IPC、window
2. Event stream 驱动：`RuntimeEvent → store → UI`
3. `loop/` 不直接 import `policy/`：通过 `beforeToolExecute` hook 注入
4. Desktop 和 Web 只是 Transport 层不同，其余代码完全共享

**模块边界规则**：

- `loop/` 只依赖注入接口（`IAIProvider`、`IAgentEventEmitter`、`AgentTool`、`beforeToolExecute` hook）
- `Runtime.ts` 是唯一组装点，模块之间不互相 import

---

## 当前进度

### 已完成（`refactor/agent-runtime-cleanup` 分支）

- `packages/agent-runtime/` 完全 headless：不依赖 `@main/*`、Electron、IPC、DOM
- 只接收纯数据 `RuntimeStartInput` + 注入接口
- 事件通过 `IAgentEventEmitter` 发出；消息写入、压缩策略由外部注入
- 工具 schema、输出格式、硬编码中文已移除
- `src/main/agent/runtime/` 死代码已清理
- 8 组单元测试 + E2E 测试覆盖
- `AgentError` 类替代字符串匹配错误码

### 下一步

| 工作 | 说明 |
|------|------|
| 包重组 | `packages/agent-runtime/` → `packages/runtime/loop/`，新建 `policy/` `session/` 等模块 |
| `beforeToolExecute` hook | `loop/` 中策略/审批逻辑剥离到 `policy/`，通过 hook 注入 |
| 统一 Transport | 定义 `RuntimeEvent` union type，Renderer store 只消费 `RuntimeEvent` |
| Web 接入 | WebSocket transport adapter，复用同一套 runtime |
