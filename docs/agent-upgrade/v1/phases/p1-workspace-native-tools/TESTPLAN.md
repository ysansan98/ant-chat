# P1 测试计划：工作区与内置工具

### TC-P1-1：首次启动默认工作区

- 对应验收：AC-P1-1
- 步骤：清空工作区配置后启动应用。
- 期望：自动创建默认工作区 `~/.ant-chat/` 并选中。

### TC-P1-2：添加本地目录工作区

- 对应验收：AC-P1-2
- 步骤：通过 workspace service 或 UI 添加一个存在的本地目录。
- 期望：目录出现在工作区列表，可切换。

### TC-P1-2A：工作区展示名由路径计算

- 对应验收：AC-P1-2
- 步骤：添加多个 basename 相同但上级目录不同的工作区，例如 `test/demo`、`test1/demo`、`test1/a/b/demo`、`test2/a/b/demo`。
- 期望：列表项不依赖持久化 `name`，按路径差异展示为 `test/demo`、`test1/demo`、`test1/.../demo`、`test2/.../demo`。

### TC-P1-3：重复路径阻止

- 对应验收：AC-P1-3
- 步骤：添加同一个目录两次。
- 期望：第二次添加失败或提示已存在，不产生重复项。

### TC-P1-4：删除当前工作区回退默认工作区

- 对应验收：AC-P1-4
- 步骤：选中非默认工作区并删除。
- 期望：当前工作区切回默认工作区。

### TC-P1-5：只读工具读取工作区内文件

- 对应验收：AC-P1-5
- 步骤：在测试工作区创建文件，调用 `read_file/list_dir/glob_files/grep_files`。
- 期望：可以找到并读取工作区内文件。

### TC-P1-6：工作区外路径访问阻止

- 对应验收：AC-P1-6
- 步骤：调用 `read_file/list_dir/glob_files/grep_files/write_file/apply_patch/bash` 访问工作区外路径或 cwd。
- 期望：被路径策略拒绝。

### TC-P1-6A：symlink 逃逸阻止

- 对应验收：AC-P1-6
- 步骤：在工作区内创建指向工作区外目录的 symlink，分别调用文件工具和 `bash.cwd` 访问该 symlink。
- 期望：`realpath` 校验失败，请求被路径策略拒绝。

### TC-P1-7：写入类工具只写工作区内路径

- 对应验收：AC-P1-7
- 步骤：分别对工作区内外路径调用 `write_file/apply_patch/bash`。
- 期望：工作区内成功；工作区外失败且无文件变更。

### TC-P1-7A：apply_patch 多文件变更

- 对应验收：AC-P1-7
- 步骤：传入一个包含新增、修改、删除多个工作区内文件的 patch。
- 期望：patch 成功应用，所有变更都落在工作区内。

### TC-P1-7B：apply_patch 越界整体拒绝

- 对应验收：AC-P1-6、AC-P1-7
- 步骤：传入一个同时包含工作区内路径和工作区外路径的 patch。
- 期望：整体失败，工作区内外都不产生部分变更。

### TC-P1-7C：apply_patch 上下文不匹配

- 对应验收：AC-P1-7
- 步骤：传入上下文行与当前文件内容不一致的 patch。
- 期望：patch 失败，目标文件保持原样。

### TC-P1-7D：apply_patch 原子失败

- 对应验收：AC-P1-7
- 步骤：传入一个包含多个文件变更的 patch，其中一个文件路径越界或上下文不匹配。
- 期望：整体失败，所有目标文件都保持原样。

### TC-P1-7E：apply_patch 格式限制

- 对应验收：AC-P1-7
- 步骤：分别传入绝对路径、`..` 路径、已存在目标的 `Add File`、不存在目标的 `Update File/Delete File`。
- 期望：全部失败且无文件变更。

### TC-P1-7F：风险等级判定

- 对应验收：AC-P1-7、AC-P1-9
- 步骤：分别调用新建文件、覆盖文件、删除文件 patch、只读 bash、`mkdir -p`、危险 bash 命令。
- 期望：风险等级分别符合 README 的风险判定表，危险命令被阻断或标记为 L2。

### TC-P1-8：System Prompt 平台声明

- 对应验收：AC-P1-8
- 步骤：分别在 macOS 和 Windows 环境构造 Agent System Prompt。
- 期望：System Prompt 明确当前平台；仅出现 macOS 或 Windows，不出现 Linux；`BashToolInput` 不包含 `platformCommands`。

### TC-P1-9：bash 执行边界

- 对应验收：AC-P1-9
- 步骤：分别测试超时、超大 stdout、危险命令、越权 cwd、`mkdir -p <workspace-relative-path>`。
- 期望：超时返回 `AGENT_BASH_TIMEOUT`；输出被截断；危险命令和越权 cwd 被阻止；工作区内目录创建成功。

### TC-P1-9A：搜索工具使用 ripgrep

- 对应验收：AC-P1-5
- 步骤：调用 `glob_files/grep_files`，检查命令执行路径或 mock runner 入参。
- 期望：`glob_files` 使用 `rg --files`，`grep_files` 使用 `rg` 正则搜索；找不到 `rg` 时返回 `AGENT_TOOL_EXEC_FAILED`。

### TC-P1-9B：搜索 ignore 规则

- 对应验收：AC-P1-5
- 步骤：在工作区创建 `.gitignore`、`.ignore`、`.rgignore`、隐藏文件、`node_modules`、`.git`、`dist`、`build` 目录，调用 `glob_files/grep_files`。
- 期望：默认遵守 ripgrep ignore 行为和工作区内 `.gitignore/.ignore/.rgignore`，不读取全局 gitignore；隐藏文件默认不返回；默认排除 `node_modules/.git/dist/build`。

### TC-P1-10：普通聊天不回退

- 对应验收：AC-P1-10
- 步骤：启动应用，选择已有模型，发送普通问题。
- 期望：消息正常发送，助手正常回复，UI 无异常。

### TC-P1-11：未引入 Agent 执行过程表

- 对应验收：AC-P1-11
- 步骤：检查 schema 和 migration。
- 期望：不存在 `agent_runs`、`agent_steps`、`agent_tool_calls`、`agent_approval_events`。
