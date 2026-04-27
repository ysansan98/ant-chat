# P1：工作区与内置工具

## 目标

- 先建立 Agent 的执行边界：当前工作区、路径白名单、内置工具。
- 内置工具可以独立于 Agent Runtime 做单元测试和集成测试。

## 范围

- 默认工作区：`~/.ant-chat/`。
- 添加、切换、删除本地目录工作区。
- 工作区 store/file 与 workspace IPC。
- 内置工具：`read_file`、`list_dir`、`glob_files`、`grep_files`、`write_file`、`apply_patch`、`bash`。
- 路径归一化、工作区白名单、cwd 校验。
- System Prompt 平台声明、`bash` 超时、输出截断、危险命令阻断。

## 交付物

- workspace service。
- native tool service。
- path policy helper。
- bash command runner。

## 实现要点

### 工作区配置

工作区不进数据库，使用现有 store 或本地配置文件保存。

```ts
interface WorkspaceConfig {
  currentWorkspacePath?: string
  workspaces: Array<{
    path: string
    addedAt: number
    lastOpenedAt?: number
  }>
}
```

约束：
- 默认工作区固定为 `~/.ant-chat/`，首次启动时创建并选中。
- `path` 必须是本机绝对路径。
- 同一路径只能添加一次。
- 删除当前工作区后回退到默认工作区。
- 文件工具和 bash `cwd` 必须受当前工作区约束。
- 工作区唯一标识就是归一化后的 `path`，不额外生成 `id`。
- 工作区不持久化 `name`，UI 展示名由路径计算。
- UI 展示同名目录时，从第一个不同的上级目录开始展示；中间目录过多时省略中间段，例如 `test/demo`、`test1/demo`、`test1/.../demo`、`test2/.../demo`。

### Workspace IPC

新增 `src/main/domains/workspace/ipc.ts`。

```ts
interface WorkspaceItem {
  path: string
  displayName: string
  isDefault: boolean
  lastOpenedAt?: number
}

type ListWorkspacesResponse = IpcResponse<{
  currentWorkspacePath: string
  workspaces: WorkspaceItem[]
}>
```

固定方法：
- `listWorkspaces()`
- `addWorkspace(path)`
- `removeWorkspace(path)`
- `openWorkspace(path)`

Renderer 事件：

```ts
'workspace:changed': [
  {
    currentWorkspacePath: string
  }
]
```

### 会话与消息数据影响

V1 不新增 `workspaces` 表。工作区路径作为会话字段保存，用于后续按工作区过滤。

`conversations` 固定字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text(pk) | 会话 ID |
| workspace_path | text nullable | 会话所属工作区路径 |
| title | text | 会话标题 |
| settings | json text nullable | 会话设置快照 |
| created_at | integer | 创建时间 |
| updated_at | integer | 更新时间 |

固定索引：
- `idx_conversations_workspace_path_updated_at`
- `idx_conversations_updated_at`

`messages` 保持轻量：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text(pk) | 消息 ID |
| conversation_id | text(fk) | 会话 ID |
| role | text | system/user/assistant |
| status | text | pending/streaming/success/error/cancelled |
| content | json text | 消息内容 |
| reasoning_content | text nullable | reasoning 文本 |
| model_info | json text nullable | provider/model 快照 |
| attachments | json text nullable | 附件 |
| error | text nullable | 错误信息 |
| created_at | integer | 创建时间 |
| updated_at | integer | 更新时间 |

约束：
- `conversation_id` 删除时级联删除消息。
- `role` 不新增 `tool`。工具执行不作为独立 message 存储。
- 不把复杂任务进度写入 `messages.metadata`。

### 内置工具接口

P1 内置工具保持小而明确：

| 工具 | 说明 | 风险 |
|---|---|---|
| `read_file` | 读取工作区内文件内容，支持 `offset/limit` 防止超大输出。 | L0 |
| `list_dir` | 列出工作区内目录项。 | L0 |
| `glob_files` | 按 glob pattern 查找文件，默认遵守 ignore 规则并限制返回数量。 | L0 |
| `grep_files` | 按正则搜索文件内容，支持 `path/include` 限定范围并限制返回数量。 | L0 |
| `write_file` | 新建或覆盖工作区内文件。 | L1/L2 |
| `apply_patch` | 应用结构化 patch，可新增、删除、修改一个或多个工作区内文件。 | L1/L2 |
| `bash` | 在受控 cwd 下执行命令，支持平台命令、超时、输出截断和危险命令阻断；目录创建由受控 `mkdir` 命令覆盖。 | L1/L2 |

约束：
- 所有路径入参统一走 path policy，归一化和 `realpath` 后必须落在当前工作区内。
- 工作区内 symlink 指向工作区外路径时，文件工具必须拒绝访问。
- `bash.cwd` 必须做 `realpath` 校验；P1 不解析命令内部的 symlink 逃逸，明显包含绝对路径或 `..` 越界的命令必须阻断。
- `glob_files` 和 `grep_files` 默认限制返回数量，避免一次性把大型仓库结果塞进上下文。
- `glob_files` 和 `grep_files` 默认遵守当前工作区内的 `.gitignore` 和 `.ignore`；不读取全局 gitignore。
- 隐藏文件不默认排除；`node_modules`、`.git`、`dist`、`build` 默认排除，除非 `path/include` 明确收窄到这些目录。
- `write_file` 用于整文件写入；`apply_patch` 用于代码编辑和多文件变更，不使用 `patch_file` 这类单文件命名。
- `apply_patch` 执行前必须解析 patch 内所有文件路径，任一路径越界则整体拒绝执行。
- `apply_patch` 上下文不匹配时必须失败，不做静默覆盖。
- `bash` P1 允许只读命令和低风险目录创建命令，例如 `pwd`、`ls`、`cat`、`rg`、`find`、`mkdir -p <workspace-relative-path>`。
- `bash` P1 阻断明显危险命令，例如 `rm`、`mv`、`cp`、`chmod`、`chown`、`sudo`、重定向写入、管道写入文件、包管理安装、网络下载执行。

### apply_patch 格式

P1 使用自定义 Begin Patch 格式，不直接接收任意 `git diff`：

```patch
*** Begin Patch
*** Add File: src/new-file.ts
+export const value = 1
*** Update File: src/existing.ts
@@
-old line
+new line
*** Delete File: src/old-file.ts
*** End Patch
```

规则：
- 文件路径必须是相对当前工作区根目录的 POSIX 风格路径，禁止绝对路径、`..`、空路径。
- 支持 `Add File`、`Update File`、`Delete File`。P1 不支持 `Move File`，需要移动文件时先 delete 再 add。
- `Update File` 必须带上下文，且上下文必须和当前文件内容匹配。
- patch 执行必须是原子的：任一文件解析、校验、上下文匹配或写入失败，所有文件都保持原样。
- `Add File` 目标已存在时失败；`Update File` 和 `Delete File` 目标不存在时失败。

### 风险判定

| 场景 | 风险 |
|---|---|
| `read_file`、`list_dir`、`glob_files`、`grep_files` 访问工作区内路径 | L0 |
| `write_file` 新建文件 | L1 |
| `write_file` 覆盖已有文件 | L2 |
| `apply_patch` 只新增文件或只修改文本内容 | L1 |
| `apply_patch` 删除文件、批量修改 5 个以上文件、修改配置/锁文件 | L2 |
| `bash` 只读命令 | L1 |
| `bash` `mkdir -p` 创建工作区内目录 | L1 |
| `bash` 其它写入、删除、权限、安装、网络执行类命令 | L2 或阻断 |

```ts
interface BashToolInput {
  command: string
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string>
}

interface ReadFileToolInput {
  path: string
  offset?: number
  limit?: number
}

interface ListDirToolInput {
  path?: string
}

interface GlobFilesToolInput {
  pattern: string
  path?: string
  limit?: number
}

interface GrepFilesToolInput {
  pattern: string
  path?: string
  include?: string
  limit?: number
}

interface WriteFileToolInput {
  path: string
  content: string
}

interface ApplyPatchToolInput {
  patch: string
}

interface AgentToolResult {
  ok: boolean
  output?: unknown
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
  error?: string
}

interface AgentTool {
  name: string
  source: 'mcp' | 'native' | 'skill'
  inferRisk(input: Record<string, unknown>): 'L0' | 'L1' | 'L2'
  execute(input: Record<string, unknown>): Promise<AgentToolResult>
}
```

错误码：
- `WORKSPACE_INVALID_PATH`
- `WORKSPACE_DUPLICATED_PATH`
- `AGENT_POLICY_BLOCKED`
- `AGENT_TOOL_EXEC_FAILED`
- `AGENT_BASH_COMMAND_BLOCKED`
- `AGENT_BASH_TIMEOUT`

## 验收标准

- AC-P1-1：首次启动存在默认工作区 `~/.ant-chat/`。
- AC-P1-2：用户可以添加本地目录为工作区。
- AC-P1-3：重复添加同一路径会被阻止。
- AC-P1-4：删除当前工作区后回退到默认工作区。
- AC-P1-5：内置只读工具可读取工作区内文件。
- AC-P1-6：工作区外路径访问被阻止。
- AC-P1-7：写入类工具只能写入工作区内路径。
- AC-P1-8：System Prompt 明确当前应用所在系统平台，仅支持 macOS 和 Windows。
- AC-P1-9：bash 超时、输出截断、危险命令阻断生效。
- AC-P1-10：现有普通聊天能力不回退。
- AC-P1-11：代码中不引入 Agent 执行过程表。

## 测试

见 [TESTPLAN.md](./TESTPLAN.md)。
