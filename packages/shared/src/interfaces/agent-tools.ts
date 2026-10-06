import type { SecretRef } from '../schemas'

export type ToolOperationType = 'read' | 'write' | 'command' | 'command_read' | 'browser' | 'skill' | 'mcp'
export type ToolScope = 'workspace' | 'outside' | 'external' | 'blocked'
export type AgentToolInput = Record<string, unknown>

export interface ToolDiagnostics {
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
  data?: unknown
  /** 后台命令标识；前台命令为 undefined。 */
  commandId?: string
  /** 后台命令进程组 leader 的 pid。 */
  pid?: number
  /** 后台命令状态。 */
  status?: BackgroundCommandStatus
  /** 后台命令日志文件绝对路径。 */
  logPath?: string
  /** read_command_output 本次读取的起始字节偏移。 */
  offset?: number
  /** read_command_output 下次读取应传入的字节偏移。 */
  nextOffset?: number
  /** 日志已触及大小上限，之后不再增长。 */
  truncated?: boolean
}

export interface AgentToolResult {
  ok: boolean
  result: string
  diagnostics?: ToolDiagnostics
}

export interface AgentTool {
  name: string
  source: 'mcp' | 'native' | 'skill'
  serverName?: string
  /** MCP 工具的原始 toolName（不与 serverName 拼接）；非 MCP 工具为 undefined */
  originalToolName?: string
  description?: string
  inputSchema?: {
    type: 'object'
    properties: Record<string, Record<string, unknown>>
    required: string[]
  }
  operationType: ToolOperationType
  inferScope: (input: Record<string, unknown>) => ToolScope
  validateInput?: (input: Record<string, unknown>) => string | null
  execute: (input: Record<string, unknown>) => Promise<AgentToolResult>
  truncateResult?: boolean
}

export interface CommandToolInput {
  command: string
  /** 一句话说明命令目的，仅用于 UI 展示（消息列表工具 header），执行路径不读取 */
  description?: string
  cwd?: string
  timeoutMs?: number
  /** 仅用于把当前 Turn 的 SecretRef 注入子进程环境；不接受普通字符串或持久 SecretRef。 */
  secretEnv?: Record<string, SecretRef>
  /** true 时命令在后台运行，工具立即返回 commandId。默认 false。 */
  runInBackground?: boolean
}

export type BackgroundCommandStatus = 'running' | 'exited' | 'killed'

/** 会话级后台命令的实时摘要；App 重启后清空，日志文件仍在磁盘。 */
export interface BackgroundCommandSummary {
  commandId: string
  /** 原始命令文本。 */
  command: string
  /** 模型填写的一句话目的，仅用于展示。 */
  description?: string
  cwd: string
  status: BackgroundCommandStatus
  pid?: number
  exitCode?: number
  startedAt: number
  endedAt?: number
  /** 该后台进程是否持有 Turn 密钥（审计标记）。 */
  hasSecretEnv: boolean
  /** 注入的密钥环境变量名（不含值）。 */
  secretEnvKeys: string[]
  logPath: string
  /** 日志已触及大小上限。 */
  truncated: boolean
}

/** read_command_output 输入（agent 工具与 UI RPC 共用）。 */
export interface ReadCommandOutputInput {
  commandId: string
  /** 上次返回的 nextOffset（字节）；省略时从头读。 */
  offset?: number
  /** 单次返回上限（字节），默认 65536，最大 262144。 */
  maxChars?: number
  /** 有界等待：等到有新输出、进程退出或超时三者之一；默认 0，最大 30000。 */
  waitMs?: number
}

/** kill_command 输入。 */
export interface KillCommandInput {
  commandId: string
  /** 默认 SIGTERM；SIGKILL 用于无响应进程。 */
  signal?: 'SIGTERM' | 'SIGKILL'
}

/** 后台命令结束的原因；决定是否值得通知 agent。 */
export type BackgroundCommandNoticeReason
  = | 'exited'
    | 'user_killed'
    | 'agent_killed'
    | 'watchdog'
    | 'session_closed'
    | 'disposed'

/**
 * 面向 agent 的后台命令结束通知。
 *
 * `agent_killed` / `session_closed` / `disposed` 不会进入队列（agent 自己的动作、
 * 会话已在关闭），保留在类型里用于表达完整的结束原因。
 */
export interface BackgroundCommandNotice {
  commandId: string
  command: string
  description?: string
  status: Exclude<BackgroundCommandStatus, 'running'>
  exitCode?: number
  reason: BackgroundCommandNoticeReason
  startedAt: number
  endedAt: number
}

export interface BackgroundCommandReadResult {
  text: string
  status: BackgroundCommandStatus
  exitCode?: number
  offset: number
  nextOffset: number
  truncated: boolean
}

export interface BrowserToolInput {
  command: string
  args?: string[]
  timeoutMs?: number
  /** 是否注入应用托管的登录 Cookies；仅首次导航/跨域时生效，默认 true。 */
  injectCookies?: boolean
}

/** browser_navigate 工具：打开 URL */
export interface BrowserNavigateInput {
  url: string
  headed?: boolean
  profile?: string
  /** 是否注入应用托管的登录 Cookies，默认 true；设为 false 时以未登录状态打开。 */
  injectCookies?: boolean
  timeoutMs?: number
}

/** browser_back 工具：浏览器后退 */
export interface BrowserBackInput {
  timeoutMs?: number
}

/** browser_reload 工具：刷新页面 */
export interface BrowserReloadInput {
  timeoutMs?: number
}

/** browser_close 工具：关闭浏览器 */
export interface BrowserCloseInput {
  timeoutMs?: number
}

/** browser_snapshot 工具：获取页面可访问性快照 */
export interface BrowserSnapshotInput {
  /** CSS 选择器，限定快照范围 */
  selector?: string
  timeoutMs?: number
}

/** browser_click 工具：点击页面元素 */
export interface BrowserClickInput {
  /** 可访问性快照中的 @eN 引用 */
  ref?: string
  /** CSS 选择器，作为 ref 的替代 */
  selector?: string
  /** 是否在新标签页打开链接 */
  newTab?: boolean
  timeoutMs?: number
}

/** browser_type 工具：在输入框中输入文本 */
export interface BrowserTypeInput {
  /** 可访问性快照中的 @eN 引用 */
  ref?: string
  /** CSS 选择器，作为 ref 的替代 */
  selector?: string
  /** 要输入的文本 */
  text: string
  timeoutMs?: number
}

/** browser_press 工具：按键 */
export interface BrowserPressInput {
  /** 按键组合，如 Enter、Tab、Control+a */
  key: string
  timeoutMs?: number
}

/** browser_scroll 工具：滚动页面 */
export interface BrowserScrollInput {
  /** 滚动方向 */
  direction?: 'up' | 'down' | 'left' | 'right'
  /** 滚动像素量（正数） */
  amount?: number
  /** CSS 选择器，限定滚动容器 */
  selector?: string
  timeoutMs?: number
}

/** browser_dialog 工具：处理浏览器对话框 */
export interface BrowserDialogInput {
  /** 对话框操作 */
  action: 'accept' | 'dismiss'
  /** dialog accept 时可选的输入文本 */
  text?: string
  timeoutMs?: number
}

/** browser_eval 工具：在页面中执行 JavaScript */
export interface BrowserEvalInput {
  /** JavaScript 表达式 */
  expression: string
  timeoutMs?: number
}

export interface ReadFileToolInput {
  path: string
  offset?: number
  limit?: number
}

export interface ListDirToolInput {
  path?: string
  offset?: number
  limit?: number
}

export interface GlobFilesToolInput {
  pattern: string
  path?: string
  limit?: number
}

export interface GrepFilesToolInput {
  pattern: string
  path?: string
  include?: string
  limit?: number
}

export interface WriteFileToolInput {
  path: string
  content: string
}

export interface EditFileToolInput {
  path: string
  edits: Array<{
    oldText: string
    newText: string
  }>
}
