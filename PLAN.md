**内置指令系统设计**

**Summary**

第一版只做三个内置指令：`/compact [instruction]`、`/new`、`/fork`。`/` 面板同时展示内置指令和 Skill。内置指令走 command 通道，不进入普通 agent turn；Skill 保持现有 `selectedSkill` 行为。

**Key Changes**

- 新增 `BuiltinCommand`：`id`、`title`、`description`、`usage`、`allowArgument`、`requiresConversation`、`blocksInput`。
- `/` 面板分组展示：
  - Built-in Commands：`/compact`、`/new`、`/fork`。
  - Skills：继续展示已启用 Skill。
- `Sender` 提交前解析 draft：
  - `/compact` 允许多行文字参数。
  - `/new` 和 `/fork` 不接受参数。
  - 指令混入附件、`@file`、Skill 或其他普通文本时拒绝执行。
- 新增共享接口：`commands.runBuiltinCommand({ id, conversationId, argument, modelConfig, workspacePath })`，Electron IPC 和 local-server RPC 都实现。
- 命令运行期间设置 conversation 级 `commandRunning`，禁用输入框、附件和发送按钮；同会话 agent task 正在运行时拒绝执行命令。

**Command Behavior**

- `/compact [instruction]`
  - 压缩当前会话上下文。
  - `instruction` 原文传给压缩模型，作为重点保留和忽略内容的指导。
  - 扩展 `CompactionInput.instruction?: string` 和 `CompactionStrategy.summarize(...)` 参数。
  - 成功后写 `role: event`、`eventType: compaction`，复用现有消息展示。
  - 无需压缩时写一条 compaction event，内容为 `Context is already compact enough.`。
- `/new`
  - 立即创建一个空会话。
  - 使用 `DEFAULT_TITLE`。
  - 继承当前 workspace。
  - 使用当前 UI 的模型和会话设置初始化新会话 settings。
  - 创建后插入侧边栏顶部，并切换 active conversation 到新会话。
- `/fork`
  - 基于当前会话新建一个会话。
  - 复制当前会话全部消息、settings 和 workspace。
  - 新标题为 `原标题 fork`。
  - 在新会话消息列表开头写一条 event，说明来源会话，例如 `Forked from: <source title> (<source id>)`。
  - 创建后插入侧边栏顶部，并切换 active conversation 到 fork 会话。

**Implementation Notes**

- `/new` 优先复用现有 `createConversations`、`addConversationsAction`、`setActiveConversationsId`。
- `/fork` 需要新增后端 command/service 方法，避免 renderer 逐条复制消息导致跨端行为不一致。
- fork 复制消息时生成新 message id，保留 role、content、status、eventType、reasoning、tool blocks、modelInfo、usage、duration 等可展示字段。
- fork 的来源 event 使用 `role: event`，新增 `eventType: fork`；`MessageBubble` 增加 label：`会话 Fork`。
- fork 不复制活动任务状态，不复制 streaming state，不复制 abort callbacks。

**Test Plan**

- parser 单测：`/compact` 参数保留多行原文；`/new`、`/fork` 拒绝参数和附件。
- `Sender` 测试：三个内置指令调用 command API；普通 `/skill` 仍调用 `startTurn`。
- runtime/service 测试：
  - `/compact` 传入 instruction 并写 compaction event。
  - `/new` 创建空会话并返回新 conversation。
  - `/fork` 复制全部消息并写来源 event。
  - 活动任务存在时拒绝命令。
- UI 测试：`/new`、`/fork` 后侧边栏出现新会话并切换 active conversation。
- 验证命令：`pnpm type-check`、`pnpm lint`、`pnpm test:unit`。

**Assumptions**

- 第一版只支持这三个内置指令。
- `/fork` 默认复制当前会话全部消息。
- `/fork` 标题固定为 `原标题 fork`，不调用标题模型。
- `/new` 创建后立即在侧边栏可见。
