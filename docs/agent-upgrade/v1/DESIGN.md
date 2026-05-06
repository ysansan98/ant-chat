# Ant Chat Agent 升级设计文档（V1）

> 状态：Draft（已对齐当前讨论结论）
>
> 项目：`~/webproject/ant-chat`
>
> 目标版本目录：`docs/agent-upgrade/v1/`

---

## 1. 背景与目标

当前 ant-chat 已具备：

- 多模型对话能力（主流程在 `src/main/ai-providers/services/chat-service.ts`）
- MCP 连接与工具调用能力（`src/main/domains/mcp/ipc.ts` + `packages/mcp-client-hub`）

但现状仍偏“对话工具”：

- 缺少主进程内的 Agent 多步循环（L2 loop）
- 工具调用依赖前端触发与串联
- 缺少风险审批引擎与托管执行模式
- 缺少 Skill 体系（可导入、可治理、可运行）

**本次 V1 目标：**
将 ant-chat 从“对话工具”升级为“可托管 Agent（L2）”，并具备：

1. L2 多步循环（plan/act/observe）
2. Codex 风格风险分级 + 混合审批 + 全权托管
3. 复杂任务进度提示（简洁悬浮在输入框上方）
4. Skill（基于本地目录，支持 `skill.sh` 导入）
5. 内置工具（文件查找、文件读写、命令执行等）
6. Codex-like 工作区 UI：左侧对话列表 + 工具区 + 工作区管理
7. 设置页独立窗口
8. 前端 UI 技术栈从 Ant Design / Ant Design X 迁移到 TailwindCSS + 无头组件库

---

## 2. 本版已确认决策

1. Agent 自治级别：**L2**
2. 风险策略默认：**混合（高风险确认）**
3. 用户侧不做常驻执行详情面板；复杂任务只显示**输入框上方轻量进度列表**
4. Skill：**支持，且基于本地目录管理**
5. 风险分级参考 Codex，并支持：**全权托管模式**
6. Skill 导入：**支持从 `skill.sh` 导入**
7. 内置工具：**文件查找、文件读写、bash 命令执行等本地工具**
8. 数据设计：**保持简单，不新增 Agent 执行过程表**
9. UI 布局：**参考 Codex App，引入工作区与工具区**
10. 设置：**从主窗口路由页改为独立设置窗口**
11. 组件栈：**移除 Ant Design / Ant Design X，改用 TailwindCSS + 无头组件库**

---

## 3. 设计边界（Scope）

### 3.1 In Scope（V1）

- 单会话、单 Agent Runtime（L2）
- MCP + 内置工具 + Skill 工具统一调度
- 风险分级、审批状态机、托管模式切换
- 不新增 Agent 执行过程表；复杂任务进度优先作为运行时 UI 状态
- 主窗口 UI 重构：工作区、工具区、对话列表、聊天区
- 基础设置窗口（模式、工作区、skill 目录、模型、MCP）
- 默认工作区 + 用户手动添加目录作为新工作区
- 移除 Ant Design / Ant Design X 的运行时依赖，组件改为 TailwindCSS + 无头组件库实现

### 3.2 Out of Scope（V1 不做）

- 多 Agent 协作（planner/executor/reviewer 分体）
- 云端 skill 市场/远程分发
- 复杂权限系统（组织级 RBAC）

---

## 4. 总体架构

```text
Renderer Main Window (Workspace + Tools + Conversations + Chat + Progress + Approval UI)
      │ IPC
      ▼
Main Agent Domain (agent/ipc.ts)
      ▼
Agent Runtime (runtime.ts)
  ├─ Planner
  ├─ Policy Engine (risk + mode)
  ├─ Tool Router
  │    ├─ MCP Tools
  │    ├─ Native Tools
  │    └─ Skill Tools (skill.sh adapter)
```

核心变化：

- 将“工具执行串联逻辑”从前端挪到主进程 Runtime。
- 前端主要负责：展示、确认、取消、重试。
- 主窗口从单纯 Chat Shell 重构为 Codex-like Workspace Shell。
- 设置从主窗口页面中剥离为独立 Electron Window。

---

## 5. 风险分级与执行模式

### 5.1 风险分级

- **L0 Safe Read**：只读（查找/读取）
- **L1 Bounded Write**：受限写（工作区内写/patch）
- **L2 Destructive/External**：删除、脚本执行、外部副作用

### 5.2 执行模式

- `strict`：全部确认
- `hybrid`（默认）：L0 自动，L1/L2 视策略确认
- `full_managed`：自动执行（仅保留硬阻断）

### 5.3 全权托管下的硬阻断（不可关闭）

- 非工作区路径访问/写入
- 明确危险模式（如高危 destructive 操作模板）
- 超预算（最大步数/时间/token）

---

## 6. Skill 体系（FS-first，不入库）

## 6.1 管理原则

- Skill 本体以**文件系统为准**（FS-first）
- 不将 skill 内容入库；运行过程也不为 Skill 单独建表

### 6.2 建议目录结构

```text
.ant/skills/
  <skill-name>/
    SKILL.md
    skill.sh
    manifest.json
    templates/
.ant/skills/.index.json   # 可重建缓存（可选）
```

### 6.3 `skill.sh` 协议（V1）

- `skill.sh metadata --json`
- `skill.sh run --input '<json>' --context '<json>'`

### 6.4 导入流程

1. 用户在设置页选择 `skill.sh`
2. Agent 校验可执行权限与 metadata
3. 复制/链接到 `.ant/skills/<skill-name>/`
4. 更新 `.index.json`
5. 立即可用于 Tool Router

---

## 7. 内置工具（Native Tools）

V1 首批：

- `find_files(pattern, path, glob?)`
- `read_file(path, offset?, limit?)`
- `write_file(path, content, mode=overwrite|append)`
- `patch_file(path, old, new)`
- `mkdir(path)`
- `bash(command, cwd?, timeoutMs?, env?, platformCommands?)`

`bash` 工具说明：

- 用于在受控工作区内执行命令，支持按平台选择命令。
- `platformCommands` 可选，用于同一意图在不同系统下使用不同命令：
  - `darwin`：macOS 命令
  - `win32`：Windows 命令
  - `linux`：Linux 命令
  - `default`：兜底命令
- Runtime 根据 `process.platform` 选择最终命令；未提供平台命令时使用 `command`。
- Windows 下不强制依赖 Bash，可由底层 Command Runner 适配 PowerShell / CMD；工具名保留为 `bash`，对模型暴露统一命令执行能力。
- 输出必须截断保存，完整 stdout/stderr 仅在必要时落临时日志文件并纳入清理策略。

安全约束：

- 统一路径归一化与工作区白名单
- 写入大小上限、调用频率限制
- `bash` 必须设置 `cwd` 白名单、超时、stdout/stderr 上限、环境变量白名单
- `bash` 禁止交互式命令、后台常驻进程、明显破坏性命令模板
- 默认风险等级：
  - find/read: L0
  - write/patch/mkdir: L1（按策略可要求确认）
  - bash: L2（hybrid 下默认确认；仅允许策略引擎将明确只读命令降为 L0/L1）

---

## 8. 数据设计（保持简单）

本版不新增 Agent 执行过程表，也不把工具调用、审批、任务步骤拆成独立数据模型。原则：

- 工作区是用户偏好配置，使用 store 或本地配置文件保存，不进数据库
- 数据库只关心长期有价值的数据：会话和消息
- Agent 的执行过程是运行时状态，复杂任务进度只用于当前 UI 展示
- Skill 本体仍 FS-first，不入库
- 不为了未来可能的历史调试或统计提前加表

建议保留的核心数据：

1. 本地工作区配置（store / file）

- 默认工作区
- 用户添加的目录列表
- 当前选中的工作区
- 最近打开时间

2. `conversations`

- `id`
- `workspace_path` nullable
- `title`
- `settings`
- `created_at`, `updated_at`

3. `messages`

- `id`
- `conversation_id`
- `role` (system/user/assistant)
- `status` (pending/streaming/success/error/cancelled)
- `content`
- `reasoning_content`
- `model_info`
- `attachments`
- `created_at`, `updated_at`

> 如果后续确实需要历史调试或统计能力，再单独设计对应存储。V1 不提前做这部分。

---

## 9. IPC 与前端交互

### 9.1 新增 IPC Service

`src/main/domains/agent/ipc.ts`

建议方法：

- `startTask(payload)`
- `approvePendingAction(taskId)`
- `rejectPendingAction(taskId, reason?)`
- `cancelTask(taskId)`

`src/main/domains/workspace/ipc.ts`

建议方法：

- `listWorkspaces()`
- `addWorkspace(path, name?)`
- `setDefaultWorkspace(workspaceId)`
- `removeWorkspace(workspaceId)`
- `openWorkspace(workspaceId)`

`src/main/domains/settings/ipc.ts`

建议方法：

- `openSettingsWindow()`
- `getSettings()`
- `updateSettings(patch)`

### 9.2 新增 Renderer 事件

- `agent:state-updated`
- `agent:progress-updated`
- `agent:approval-required`
- `workspace:changed`
- `settings:updated`

### 9.3 UI

主窗口采用 Codex-like 工作区布局：

- 左侧对话列表：按当前工作区过滤 conversation，支持新建、重命名、删除、搜索
- 工具区：展示 MCP、Skills、内置工具入口和状态，作为工作区级能力面板
- 工作区切换：默认工作区常驻，用户可手动添加本地目录作为新工作区
- 中央聊天区：保持对话为主，不常驻额外执行详情面板
- 复杂任务进度：仅在 Agent 运行复杂任务时显示，悬浮在输入框上方，一行一个任务，状态为已完成/进行中/未开始
- 待审批交互：以内联卡片或输入框上方紧凑条展示，不使用大面积 modal
- 运行模式指示：在输入框附近或顶部状态区展示 strict/hybrid/full_managed

设置页调整为独立窗口：

- 主窗口只保留设置入口，点击后通过 IPC 打开独立 Settings Window
- 设置窗口承载模型、服务商、MCP、Skills、工作区、Agent 模式等配置
- 设置保存后通过 `settings:updated` 通知主窗口刷新

组件技术栈：

- 移除 `antd`、`@ant-design/icons`、`@ant-design/x` 的 UI 依赖
- 样式使用 TailwindCSS
- 交互组件使用无头组件库，优先选择 Radix UI 或 Headless UI，最终只保留一个主方案
- 图标使用轻量图标库（如 lucide-react），避免继续依赖 Ant Design Icons
- 迁移顺序从基础 Shell、按钮、输入框、弹层、菜单开始，再替换 Chat/Sender/Settings/MCP 页面

---

## 10. 分阶段实施

V1 拆成多个可独立验收的阶段，避免 Runtime、UI、组件栈、Skill 同时推进导致范围失控。

阶段索引见 `PHASES.md`；每个阶段的详细设计和测试用例放在 `phases/<phase>/` 目录下。

阶段顺序：

1. P1：工作区与内置工具
2. P2：Agent Runtime 与审批
3. P3：Skill FS-first
4. P4：主窗口 UI Shell
5. P5：设置独立窗口
6. P6：组件栈迁移与收敛

每个阶段必须满足：

- 有明确交付物
- 有阶段验收标准
- 每条验收标准在对应阶段目录的 `TESTPLAN.md` 中有对应测试用例
- 未通过当前阶段测试前，不进入下一阶段

---

## 11. 风险与回滚

- 风险：自动执行策略误判导致误操作
  - 缓解：L1/L2 默认确认 + 硬阻断 + 预算上限
- 风险：skill.sh 执行不可控
  - 缓解：目录白名单、执行超时、stdout大小限制
- 风险：bash 命令执行带来跨平台差异与外部副作用
  - 缓解：平台命令显式输入、L2 默认审批、命令超时、输出截断、禁止交互式/后台常驻命令
- 风险：一次性移除 Ant Design / Ant Design X 范围较大
  - 缓解：先稳定 Shell 与基础组件，再逐页迁移；迁移期间保留 feature flag 或分支隔离
- 风险：设置窗口与主窗口状态不同步
  - 缓解：设置写入统一走主进程 settings service，并通过事件广播刷新 Renderer
- 回滚：保留旧 chat-only 入口开关，Runtime 可按 feature flag 灰度

---

## 12. 配套文档

- `PHASES.md`：阶段索引
- `phases/*/README.md`：单阶段目标、范围、交付物、验收标准
- `phases/*/TESTPLAN.md`：单阶段测试用例
