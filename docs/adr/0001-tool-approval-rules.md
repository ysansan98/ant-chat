# ADR-0001：交互审批采用结构化权限规则与独立存储

权限规则表达用户明确允许或禁止的能力边界，而不是某次工具调用的完整字符串。规则按命令、文件系统和 MCP 三类结构化表达，独立保存到 `~/.ant-chat/permissions.json`，由 Agent Runtime 统一匹配和持久化。

## 状态

已接受，2026-07-22。

取代 [工具记忆授权由 Agent Runtime 统一裁决](./tool-approval-whitelist-architecture.md) 中关于白名单数据结构、匹配粒度、存储位置和管理方式的决策。基础策略、审批事务 owner 与 Trace 的原则继续保留，并与 [Agent 工具权限按能力、资源域和运行来源统一裁决](./agent-tool-permission-architecture.md) 共同生效。

## 背景

当前 `toolApprovalWhitelist` 将规则保存为 `toolName + operationType + toolScope + pattern`。命令规则虽然已经从过宽的 `node **` 收紧为完整命令键，但参数稍有变化就会再次审批；MCP 按完整 input 匹配同样缺少复用价值。反过来，重新引入无语义的 glob 又会把授权扩大到用户没有确认的操作。

此外，规则仍属于通用 settings：没有独立的生命周期和管理页，工作区作用域与资源范围混在单条记录中，前端只能在审批卡片里追加规则，无法可靠编辑、审计或处理工作区和 MCP 服务的重命名、删除。

需要解决的问题不是“让字符串匹配更宽松”，而是让每类工具把可复用的能力表达为后端能验证的结构化规则。

## 决策

### 1. 黑名单优先，白名单只满足交互审批

权限裁决顺序保持为：

```text
工具准备与输入校验
  -> 命中 deny 规则则阻止本次工具调用
  -> 基础策略 allow / require_approval / block
  -> 仅 require_approval 查询 allow 规则
  -> 命中则 allow，否则等待用户审批
```

- `deny` 规则是黑名单：优先于 allow 规则、基础 allow 和 `full_managed`，命中后返回可理解原因作为工具结果，不中断 Agent loop。
- `allow` 规则只能把交互 Turn 的 `require_approval` 转为 `allow`。
- allow 规则不能覆盖 `block`、工具输入校验或命令底线阻断。
- `full_managed` 只跳过人工审批，不能跳过硬阻断。
- Automation 使用自身穷举的 `permissionPolicy`，不读取 allow 规则也不等待人工审批；deny 规则仍生效。
- Agent Runtime 是审批事务的唯一 owner；工具侧负责构造类型化授权目标，权限仓库只负责校验后的原子持久化。

### 2. 权限独立保存，不兼容旧白名单

权限配置从 `settings.json` 抽离为 `~/.ant-chat/permissions.json`：

```json
{
  "schemaVersion": 1,
  "data": {
    "global": [],
    "workspaces": {
      "/canonical/workspace/path": []
    }
  }
}
```

- `global` 规则可被当前和未来添加的所有工作区使用。
- `workspaces` 以 canonical 工作区路径为 key；其中规则仅能被该工作区的会话使用，规则本身不重复保存 `workspacePath`。
- 全局和当前工作区分组共同组成一次交互 Turn 的有效规则集合。
- 每条规则使用稳定 `id`，并记录 `createdAt`、`updatedAt`；不增加临时禁用或过期字段。
- workspace path 在 Turn 入口统一 canonicalize，后续任务快照、规则分组和匹配都使用同一身份。
- 文件采用校验 schema 和原子替换写入。读取失败或内容损坏时不加载任何规则，隔离损坏文件后立即原子创建合法空文件，并保留隔离文件用于诊断。交互 Turn 按“无已记住授权”继续进入人工审批，不能自动执行，也不应终止 Agent loop。
- 通用设置重置不删除权限文件。

当前没有正式版本，不实现旧 `toolApprovalWhitelist` 的迁移、兼容读取或双写。实施切换时手动清空现有白名单，并从 App Settings schema、repository 和 runtime wiring 中删除旧字段。

### 3. 规则是封闭的类型联合

首版只支持三类持久规则：

```ts
type ToolApprovalRule = CommandRule | FilesystemRule | McpToolRule

interface RuleBase {
  id: string
  createdAt: number
  updatedAt: number
  effect?: 'allow' | 'deny' // 缺失兼容旧 allow 规则
}

interface CommandRule extends RuleBase {
  kind: 'command'
  interpreter: 'bash' | 'powershell7' | 'windows-powershell' | 'cmd'
  executable: string
  argvPrefix: string[]
  allowRemainingArgs: boolean
  resourceScope: 'workspace' | 'outside'
}

interface FilesystemRule extends RuleBase {
  kind: 'filesystem'
  access: 'read' | 'write'
  targetType: 'file' | 'directory'
  canonicalPath: string
  recursive: boolean
}

interface McpToolRule extends RuleBase {
  kind: 'mcp-tool'
  serverName: string
  toolName: string
}
```

持久化 schema 必须进一步约束：目录规则只能是递归读取，文件规则只能是精确读或写。禁止递归目录写入。

Browser 暂不支持持久规则。它的指令未来拆成独立工具后再设计授权粒度；在此之前 Browser 审批只能选择单次允许。未知工具也不回退到完整 input 或任意 input 的通用规则。

### 4. 规则分组与资源边界是两个维度

规则所在分组回答“哪些工作区可以复用”，规则内容回答“允许或禁止什么”：

- 工作区分组中的 `git show` 规则只供该工作区使用。
- 全局分组中的 `git show` 规则可在工作区 A、工作区 B 以及未来添加的工作区使用。
- 上述两种规则默认仍只匹配 `resourceScope: 'workspace'`，即 cwd 与可见路径参数位于当前工作区根目录或其子目录。
- 如用户明确授权工作区外的命令操作，保存独立的 `resourceScope: 'outside'` 规则；全局分组不自动代表任意本机路径。
- 文件规则的 `canonicalPath` 才是被授权资源；分组只限制哪些工作区可以使用这项授权。

命令的 `workspace` 分类不是操作系统沙箱。它只能约束 Agent 提交的 cwd 和可见路径参数；被启动的本机程序仍可能在内部读取其他路径。产品文案不得声称命令“只能访问工作区”。本地 Agent 的目标是防止模型意外扩大权限，不承诺防御恶意本机程序或可执行文件在匹配后被替换。

### 5. 命令宿主、adapter 与权限共同使用 prepared command

App Runtime 启动时只探测一次命令宿主。POSIX 固定 Bash 绝对路径；Windows 按
`pwsh.exe → powershell.exe → cmd.exe` 固定一个解释器。每个 Turn 只注册稳定工具
`execute_command`，不得暴露 `bash` 或 Windows 专用工具名。找不到解释器时不注册
命令工具，但 App Runtime 继续启动并通过只读状态 RPC 暴露可行动诊断。

Bash adapter 与 Windows adapter 都产生同一种 prepared command。它固定原始命令、
解释器身份、canonical cwd、解析段、资源域、只读结论、风险结论和执行计划。scope
推导、权限规则、Automation、Trace 与 runner 必须消费这份状态，禁止根据工具名、
解释器名或原始字符串重新猜测。runner 只执行 prepared plan 中固定的解释器绝对路径
和显式参数，并关闭二次 shell 选择。

命令风险分为：

- `ordinary`：按基础策略和 Permission Rule 裁决。
- `requires_approval`：删除、网络、安装、提权、环境修改和可执行但不能持久授权的复杂
  语法；strict/hybrid 单次审批，`full_managed` 直接执行，Automation 由自身穷举策略
  决定，均不生成或命中持久 allow。
- `bottomline_block`：危及系统根、用户目录根、工作区根及祖先，或无法证明授权对象
  等于执行对象；所有模式和 Automation 都不可覆盖。

规则支持三种粒度：

1. 精确命令：`argvPrefix` 等于完整参数，`allowRemainingArgs` 为 `false`。
2. 固定前缀：例如 `git show`，`argvPrefix` 为 `["show"]`，`allowRemainingArgs` 为 `true`。
3. 命令任意参数：`argvPrefix` 为空且 `allowRemainingArgs` 为 `true`。

交互审批默认生成精确命令规则。只有用户主动缩短固定参数边界或显式开启尾部参数时，才生成固定前缀规则。`allowRemainingArgs: true` 表示 `argvPrefix` 中每个参数仍必须完整出现且顺序一致，其后允许零个或任意多个参数；它不会让 `argvPrefix` 的最后一个参数变成可选。界面必须展示最终授权范围，不能用“允许后续参数”这种容易误解为“最后一个参数可忽略”的文案。

用户可在结构化表单中调整参数分界；不支持逐参数通配符、可选参数或自由 glob。命令任意参数的授权范围过大，只能由用户主动选择，系统不得自动建议，并需要二次确认。

`interpreter + executable` 共同构成规则身份。Bash 规则不得匹配 PowerShell/CMD，
Windows 规则也不得匹配 Bash。PATH/相对命令保留用户文本；绝对路径按宿主路径语义
规范化。规则身份不承担运行期重新探测解释器或 PATH 的职责。

权限页可直接填写 PATH 命令名或绝对路径，不要求用户执行 `which`。提交绝对路径规则时仅验证文件存在且可执行，防止保存垃圾路径；验证通过后按用户输入的原始字符串存库，不解析 symlink。

所有有效命令使用 Command Host 的受控环境。Bash 用
`--noprofile --norc -c`；PowerShell 用 `-NoLogo -NoProfile -NonInteractive -Command`；
CMD 用 `/d /s /c` 禁用 AutoRun。解释器语法只能由对应 adapter 解释。

命令工具不提供通用 `env`。秘密只能通过
`secretEnv: Record<string, SecretRef>` 专用通道注入：仅接受当前 Turn 的 SecretRef、
合法环境变量名，明确拒绝字符串、persistent SecretRef 和 `PATH`。SecretRef 只在权限
放行后由 command owner 解析，stdout、stderr 与 Trace 继续脱敏。带 `secretEnv` 的命令
不是 `command_read`，也不能生成或命中持久 allow。

为避免从命令文本重新引入通用环境通道，`NAME=value command`、环境修改命令以及可嵌套命令的 shell/包装器一律硬阻断。普通非秘密环境也不能由模型自行注入。

#### 平台语法与底线边界

- Bash 允许单个命令或 `&&`；PowerShell 与 CMD 分别使用各自 adapter 的静态语法边界。
- `cd` 只改变后续段的执行上下文，不作为可授权命令保存。
- 一个调用包含多个 `&&` 段时，每段独立匹配和生成规则；审批卡片仍只显示一次，并只列出尚未授权的段。
- 用户一次确认保存多条规则时，必须在恢复任务前以一次原子写入全部保存；任何一条无效或写入失败都不执行任何段。
- 引号内的 `&&` 不是分隔符。
- `&&` 前后缺少命令或连续出现时按无效输入拒绝，不得静默丢弃空段。
- 可以静态分析的 `sudo`、`env`、`command` wrapper 继续分析最终命令；动态 shell、
  PowerShell `-Command` 嵌套、脚本和动态变量直接底线阻断。
- POSIX 保护 `/`、系统关键目录、HOME 根、工作区根及祖先和挂载卷根；只保护根本身
  和覆盖全部内容的表达式，不阻断普通子目录。
- Windows 按大小写不敏感语义规范化 `/`、`\`、drive、UNC、扩展路径、junction/
  reparse point 和 8.3 短路径；保护 drive/UNC/device 根、系统目录、User Profile 根、
  工作区根及祖先。
- `rm`、`Remove-Item`、`del`、`erase`、`rd`、`rmdir` 根据静态目标分类，不再因
  basename 一刀切禁止。工作区内部构建产物属于 `requires_approval`，根级目标属于
  `bottomline_block`。
- 参数安全的 `git status`、`git diff`、`git log`、`git show` 归入 `command_read`，
  但必须拒绝会写文件或执行外部程序的参数。

### 6. 文件系统规则按 canonical 资源匹配

文件系统规则首版支持：

- 精确文件读取；
- 精确文件写入；
- 目录递归读取。

目录读取规则覆盖 `read_file`、`list_dir`、`glob_files`、`grep_files` 的对应资源范围，不授权命令工具中的 `cat`、`find` 或其他进程。匹配使用 realpath；目标尚不存在时绑定最近存在祖先的真实路径，并在后续操作时重新校验，symlink 逃逸不能命中规则。

审批文件读取时可选择当前文件或其直接父目录递归读取。`list_dir`、`glob_files`、`grep_files` 请求目录时可选择该请求目录递归读取。更高层祖先目录只能在“权限”页面通过目录选择器主动添加。首版不提供目录递归写入。

### 7. MCP 只按工具身份授权

MCP 工具名固定而 input 通常随调用变化，因此不保存完整 input 规则。持久规则只绑定独立的 `serverName + toolName`，命中后允许该工具的任意 input。审批界面只提供“仅本次允许”和“记住此 MCP 工具（任意参数）”，后者必须清楚提示授权范围。

MCP 身份在 `PreparedToolCall`、pending action 和权限匹配链路中始终以两个字段传递。禁止用 `serverName___toolName` 拼接字符串作为授权身份，避免名称组合碰撞。

首版不绑定服务配置摘要或实例 ID：同名服务配置变化后规则继续有效；删除后以同名重建，如果旧规则被保留也会重新生效。这是为降低管理复杂度接受的取舍。

### 8. 审批和“权限”页面共同管理规则

设置新增一级页面“权限”，支持按全局和工作区分组查看、添加、编辑、删除、清空规则。表单按命令、文件系统、MCP 分类型展示，不提供原始 JSON、glob 或通用 pattern 编辑器。

- 审批默认“仅本次允许”，持久保存必须由用户显式选择。
- 审批前端只提交 `taskId`、`actionId` 和用户对后端候选项的选择；后端从 pending action 重建、规范化并验证最终规则，禁止前端提交任意可执行规则。
- 管理页通过类型化 RPC 做单条或分组 mutation；后端再次 canonicalize 和校验，禁止用整份列表覆盖造成陈旧写。
- 添加、编辑或删除规则不自动恢复已经等待审批的任务。
- 审批卡片状态以 `actionId` 为身份重置；提交期间禁用操作并阻止重复 RPC；交互控件使用可访问按钮。

工作区和 MCP 生命周期与权限分组显式联动：

- 删除工作区且存在规则时，提示是否同时删除该权限分组，默认勾选；取消勾选则保留并在权限页标记“未添加的工作区”，重新添加同一 canonical 路径后自动恢复生效。
- 删除 MCP 服务时，提示是否同时删除相关规则，默认勾选；保留规则后，以同名服务重建会恢复生效。
- 重命名 MCP 服务时，如存在相关规则，界面提示受影响数量并随重命名原子迁移规则。

### 9. Trace 记录最终命中的稳定规则

Policy Trace 继续分别记录基础判定和最终判定。权限规则命中时记录稳定 rule ID、规则类型和所属分组，不以完整配置快照替代身份，也不记录无法验证的前端描述。

权限读取、匹配或写入失败必须进入 Trace。持久化失败时 pending action 保持有效，工具不执行。

## 不纳入首版

- 旧白名单迁移、兼容读取或双写。
- Browser 持久规则。
- 逐参数通配、自由 glob 或通用表达式语言。
- MCP 完整 input、字段级 input 匹配、服务指纹或配置版本绑定。
- 递归目录写入。
- 规则临时禁用、自动过期或审批后自动恢复其他 pending task。
- 用操作系统沙箱限制命令子进程，或防御恶意本机程序在匹配与执行之间替换文件。
- 防御 symlink 间接调用绕过黑白名单（如 `./mytool` 指向 `/bin/rm`）。PATH 环境变量视为可信，命令身份只按用户输入的字符串 basename 识别，不解析 symlink 真实指向。
