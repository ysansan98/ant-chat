# 消息列表工具调用渲染重构方案

> 状态：已实施。DEMO 审核反馈已并入最终实现（见文末「DEMO 审核结论」）。

## 实施前背景

- 渲染代码全部在 `apps/web`（desktop 复用同一 renderer，见 `apps/desktop/electron.vite.config.ts:52`）
- 实施前的**最外层折叠面板**是 `ProcessMessagesPanel`（「执行过程(N)」按钮）
- 实施前由 `splitTurnMessages` 把 turn 内消息二分为 process（折叠）/ visible（最后一条文本）
- 实施前 `AssistantTrace` 按**单条** assistant 消息构建 steps，仅支持消息级 tool-group（≥2 个连续 tool 才合并）
- `ToolResultContent.result` 始终是**字符串**（`agentLoop.ts:249`、`toolExecution.ts:288`）
- 内置工具全集（`nativeToolService.ts:53` + `toolRegistry.ts`）：
  - native（8）：`read_file`、`list_dir`、`glob_files`、`grep_files`、`write_file`、`edit_file`、`bash`、`browser`
  - skill/agent-loop（5）：`use_skill`、`install_skill_from_github`、`memory`、`requestSecret`、`publish_visualization`
  - MCP：`<serverName>___<toolName>`（`DEFAULT_MCP_TOOL_NAME_SEPARATOR = '___'`），`ToolCallContent.serverName` 可选
- bash 结果字符串格式：`stdout:\n…\nstderr:\n…\nexitCode=N`（`bashRunner.ts:160` `formatProcessResult`）
- shiki 已打包 `bash` / `diff` 语言（`packages/ui/src/lib/shiki-langs.ts:20,36`）

## 目标设计

### 1. 移除最外层折叠面板

- 删除 `ProcessMessagesPanel` 与 `splitTurnMessages` 的 process/visible 二分
- turn 内全部 `responseMessages` 拍平为**单条 step 流**，按时间顺序渲染
- 影响：过程性 assistant 短文本将内联显示（拍平后的自然结果，符合「下一步是渲染文字」的模型）
- steering（追加指令）消息保留现有卡片样式，作为流中的一个 step

### 2. Turn 级 step 流 + 嵌套折叠面板

新增纯函数模块 `turnSteps.ts`：`buildTurnSteps(responseMessages, toolResultMap) → TurnStep[]`

step 类型：`reasoning` / `text` / `visualization` / `error-block` / `steering` / `tool-run`

**tool-run 合并规则**：

- `role:'tool'` 的 tool-result 消息不可见，不阻断
- **reasoning 不阻断**：合并进同一个 run（作为内层 item，按时间序）
  — 理由：thinking 模型每轮迭代都有 reasoning，若阻断则汇总永远碎裂
- `text` / `visualization` / `error` / `steering` / turn 结束：阻断
- 允许跨 assistant 消息合并

**渲染结构**：

- run 内仅 1 个 tool 且无 reasoning → 单面板 `ToolCallItem`（不包外层）
- 否则 → 外层 `ToolRunPanel` + 内层 items（每个 tool 调用 / reasoning 各自一个折叠面板）

**外层 header 状态机**：

- 执行中（任一 tool executing，或 run 位于流末尾且 turn 仍 running）：
  **最后一个 tool 的 header 文案**（如「读取 src/a.ts」），文案用 `Shimmer` 包裹表达活动态；不带 loading 图标
- 已闭合（下一步是 text/visualization/steering，或 turn 结束）：
  **汇总信息**；不展示任何状态图标，组内有失败调用时汇总文案标红

**汇总格式**（固定顺序，0 次省略，` · ` 分隔）：

```
读取 N 次 · 编辑 N 次 · 写入 N 次 · 搜索 N 次 · 查找 N 次 · 列目录 N 次 · 运行 N 条命令 · 浏览器操作 N 次 · 使用技能 N 次 · 记忆操作 N 次 · 调用工具 N 次
```

按调用次数统计（与「运行n次命令」语义一致）；reasoning 不计入汇总。

**展开行为**：

- 所有折叠面板**默认收起**，不做任何自动展开（执行中、流式 reasoning 均不自动展开）
- 用户手动 toggle 记为 override，会话内保留
- activeRunId 仅用于外层 header 的文案与 shimmer 展示，不影响展开状态
- id 稳定性：run id = `run:<首个toolCallId>`；tool id = toolCallId；reasoning id = `<messageId>:reasoning`

### 2.2 内置工具 header 文案穷举

| 工具 | header 文案 | 取值来源 |
|---|---|---|
| `read_file` | 读取 `<path>` | args.path |
| `write_file` | 写入 `<path>` | args.path |
| `edit_file` | 编辑 `<path>` `+A` `-R` | args.path；A/R 见第 4 节 |
| `grep_files` | 搜索 `<pattern>` | args.pattern |
| `glob_files` | 查找 `<pattern>` | args.pattern |
| `list_dir` | 列出 `<path>` | args.path ?? `.` |
| `bash` | `<description ?? command>` | 见第 3 节 |
| `browser` | 浏览器 `<command>` `<首个参数>` | args.command + args.args?.[0] |
| `use_skill` | 使用技能 `<name>` | args.name |
| `install_skill_from_github` | 安装技能 `<name ?? url>` | |
| `memory` | 更新记忆（`<target>`） | args.target |
| `requestSecret` | 请求敏感信息 `<label>` | label 缺省展示「多个字段」 |
| `publish_visualization` | 发布可视化 | — |
| MCP | `<shortName>` + 次要文本 `<serverName>` | serverName 字段 ?? 按 `___` 拆分 |
| 未知工具 | toolName 原文 | — |

行数统计 helper：`countLines(s) = s === '' ? 0 : s.replace(/\n$/, '').split('\n').length`

### 2.3 各工具展开 body

| 工具 | body |
|---|---|
| `bash` | 见 3.1.2 |
| `edit_file` | 见第 4 节 |
| `read_file` | 结果文本，language 按 path 扩展名映射（无映射用 text） |
| `write_file` | 展示 args.content（写入内容），language 按扩展名 |
| 其余（grep/glob/list/browser/skill/mcp/未知） | 结果文本原样 CodeBlock（保持现状） |

### 3. bash 增加 description 参数

- `packages/shared/src/interfaces/agent-tools.ts:38`：`BashToolInput` 增加 `description?: string`
- `packages/backend/src/agent-core/native-tools/tools/bashTool.ts:15`：inputSchema.properties 增加
  `description: { type: 'string', description: '一句话说明这条命令的目的，例如「安装项目依赖」' }`（不进 required）；
  工具 description 追加引导「调用时用 description 字段简要说明命令用途」
- 执行路径零改动（`bashRunner` / `preValidateBashScope` 只看 command/cwd/env）

**3.1 渲染**：

- header：终端类型图标 + `args.description ?? args.command`；不展示状态图标，执行中由 `Shimmer` 表达
- body：单个代码块（`language="bash"`）：

  ```
  $ <command>
  <合并输出>
  ```

  - 解析结果字符串：剥掉 `stdout:` / `stderr:` 标记行，内容按原顺序拼接（不区分 stdout/stderr）
  - `exitCode=N` 行仅在 N ≠ 0 时保留，展示在块尾
  - 输出为空时只显示 `$ <command>`

### 4. edit_file：header 统计 + diff body

- header：`编辑 <path>` + 绿色 `+A` / 红色 `-R`；A = 所有 edit 的 newText 行数和，R = oldText 行数和（执行中即可显示，不依赖结果）
- body：由 args.edits 合成 diff，`CodeBlock language="diff"`：

  ```
  --- a/<path>
  +++ b/<path>
  @@
  -<oldText 每行>
  +<newText 每行>
  （多个 edit 依次追加 hunk）
  ```

- 合成自调用参数；工具失败（isError）时 body 改展示错误文本

## 代码改动清单

1. `packages/shared/src/interfaces/agent-tools.ts` — `BashToolInput.description?`
2. `packages/backend/src/agent-core/native-tools/tools/bashTool.ts` — inputSchema + 描述引导
3. `apps/web/src/components/Chat/toolDisplay.ts`（新增）— 纯函数：`getToolLabel` / `getEditStats` / `buildEditDiff` / `parseBashResult` / 类别汇总映射
4. `apps/web/src/components/Chat/turnSteps.ts`（新增）— `buildTurnSteps` + run 汇总
5. `apps/web/src/components/Chat/TurnTrace.tsx`（新增）— turn 级 step 流渲染组件
6. `apps/web/src/components/Chat/MessageBubble.tsx` — 删除 `ProcessMessagesPanel` / `splitTurnMessages`，AI turn 改渲染 TurnTrace
7. 测试：
   - 新增 `toolDisplay.spec.ts`、`turnSteps.spec.ts`
   - 重写 `apps/web/src/components/Chat/__tests__/MessageBubble.spec.tsx` 中执行过程相关用例（现有 13 个用例大量引用 process panel）
   - `nativeToolService.spec.ts` 增加 bash schema 含 description 断言

## 决策记录（已自行决定，可驳回）

1. 过程 assistant 文本拍平后内联显示
2. reasoning 不阻断 tool-run（内嵌为组内 item）——否则 thinking 模型下无法聚合
3. 单 tool 不包外层面板
4. 汇总按调用次数统计，不按路径去重
5. bash body 的 exitCode 仅非 0 时展示
6. MCP 工具 header 用 shortName + serverName 次要文本

## DEMO 审核结论（已并入设计）

1. **不做自动展开**：所有折叠面板默认收起（含执行中的 run、流式 reasoning），用户手动开合
2. **工具 header 不带任何状态图标**（含 loading / success / 失败）：执行中一律用 `Shimmer` 包裹 header 文案表达活动态（外层组面板 + 内层工具 + 流式 reasoning）；失败用文字标红区分，不带图标
3. **箭头挨着内容**：chevron 不固定在 header 最右侧，跟随文案并保持小间距
4. **去掉嵌套缩进**：外层面板内容区、内层面板、展开体均与外层 header 左缘平齐
5. bash 失败也走 `$ 命令` + 合并输出 + `exit N` 会话块（DEMO 自验发现：失败时展示原始结果串会带出 `stderr:` 标记行）

## 验证

- `pnpm check`（type-check + lint + unit）
- 场景走查：单 tool / 连续 tool（执行中→闭合汇总切换）/ bash 有无 description / edit_file diff / steering 打断 / reasoning 嵌入组内 / MCP 工具

## 后续项（不在本次范围）

- `AgentApprovalCard` 审批卡片可复用 `getToolLabel` 与 bash description 展示
- `turnStatus` 的「正在使用工具」shimmer 与新外层 header 信息重复，可后续精简
