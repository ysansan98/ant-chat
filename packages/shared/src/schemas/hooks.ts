import { z } from 'zod'

/**
 * Hooks：用户/工作区通过配置文件注册的外部命令，在 agent 生命周期关键点执行。
 *
 * 协议对齐 Claude Code / Codex 的事实标准：
 * - JSON stdin 输入；
 * - stdout JSON `{ decision, reason, additionalContext }`；
 * - exit code 2 = 显式拒绝（stderr 作为原因）。
 *
 * 失败隔离原则：超时/崩溃/解析失败一律按"无决策"处理，只有显式 deny 生效。
 */

// ============================================================
// 事件
// ============================================================

export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'PermissionRequest',
  'PreCompact',
  'PostCompact',
  'Interrupt',
  'Notification',
] as const

export type HookEvent = (typeof HOOK_EVENTS)[number]

/** 工具类事件：默认 10s 超时。 */
export const TOOL_HOOK_EVENTS: readonly HookEvent[] = ['PreToolUse', 'PostToolUse', 'PermissionRequest']
/** 会话类事件：默认 30s 超时。 */
export const SESSION_HOOK_EVENTS: readonly HookEvent[] = ['SessionStart', 'UserPromptSubmit', 'Stop', 'PreCompact', 'PostCompact', 'Notification']
/** 收尾类事件：默认 3s 超时，同步等待但不应拖慢主流程。 */
export const FAST_HOOK_EVENTS: readonly HookEvent[] = ['SessionEnd', 'Interrupt']

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000
export const TOOL_HOOK_TIMEOUT_MS = 10_000
export const FAST_HOOK_TIMEOUT_MS = 3_000

export function defaultHookTimeoutMs(event: HookEvent): number {
  if (TOOL_HOOK_EVENTS.includes(event))
    return TOOL_HOOK_TIMEOUT_MS
  if (FAST_HOOK_EVENTS.includes(event))
    return FAST_HOOK_TIMEOUT_MS
  return DEFAULT_HOOK_TIMEOUT_MS
}

// ============================================================
// 决策与结果
// ============================================================

/** handler 可返回的决策；`block` 与 `deny` 语义等价（协议兼容）。 */
export type HookDecision = 'allow' | 'deny' | 'ask' | 'block'

/** 归一化后的决策，聚合排序用：deny > ask > allow。 */
export type NormalizedHookDecision = 'allow' | 'ask' | 'deny'

export function normalizeDecision(decision: HookDecision | undefined): NormalizedHookDecision | undefined {
  if (decision === undefined)
    return undefined
  return decision === 'block' ? 'deny' : decision
}

export interface HookHandlerExecution {
  event: HookEvent
  source: HookConfigSource
  command: string
  decision?: HookDecision
  reason?: string
  additionalContext?: string
  /** PreCompact 语义：false 表示阻止压缩。 */
  continue?: boolean
  exitCode: number | null
  timedOut: boolean
  error?: string
  durationMs: number
}

export interface HookAggregateResult {
  event: HookEvent
  /** 归一化决策；未配置 handler 或无显式决策时为 undefined。 */
  decision?: NormalizedHookDecision
  reason?: string
  additionalContext?: string
  continue?: boolean
  executions: HookHandlerExecution[]
}

export function emptyHookResult(event: HookEvent): HookAggregateResult {
  return { event, executions: [] }
}

export interface HookInputBase {
  hook_event_name: HookEvent
  /** 会话 ID（等价 conversation_id）。 */
  session_id: string
  conversation_id: string
  /** 工作区绝对路径。 */
  cwd: string
  /** Unix epoch 毫秒。 */
  timestamp: number
}

export type HookInput = HookInputBase & Record<string, unknown>

// ============================================================
// 配置
// ============================================================

export const HOOKS_SCHEMA_VERSION = 1

export const HookCommandHandlerSchema = z.object({
  type: z.literal('command'),
  command: z.string().min(1),
  /** Windows 下的命令覆盖；未配置时回退 command。 */
  commandWindows: z.string().min(1).optional(),
  /** 单条覆盖超时（毫秒）。 */
  timeout: z.number().int().positive().optional(),
}).strict()

export const HookMatcherGroupSchema = z.object({
  /** regex；省略或 `*` 匹配全部。 */
  matcher: z.string().optional(),
  hooks: z.array(HookCommandHandlerSchema).min(1),
}).strict()

export const HooksFileSchema = z.object({
  schemaVersion: z.literal(HOOKS_SCHEMA_VERSION),
  hooks: z.record(z.string(), z.array(HookMatcherGroupSchema)),
}).strict().superRefine((file, context) => {
  for (const key of Object.keys(file.hooks)) {
    if (!(HOOK_EVENTS as readonly string[]).includes(key)) {
      context.addIssue({
        code: 'custom',
        path: ['hooks', key],
        message: `未知 hook 事件：${key}`,
      })
    }
  }
})

export type HookCommandHandler = z.infer<typeof HookCommandHandlerSchema>
export type HookMatcherGroup = z.infer<typeof HookMatcherGroupSchema>

export interface HooksFile {
  schemaVersion: typeof HOOKS_SCHEMA_VERSION
  hooks: Partial<Record<HookEvent, HookMatcherGroup[]>>
}

export type HookConfigSource = 'global' | 'workspace'

export function emptyHooksFile(): HooksFile {
  return { schemaVersion: HOOKS_SCHEMA_VERSION, hooks: {} }
}
