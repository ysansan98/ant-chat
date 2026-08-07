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
