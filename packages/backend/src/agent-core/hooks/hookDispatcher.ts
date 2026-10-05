import type { ILogger } from '@ant-chat/shared'
import type { HookConfigStore } from './hookConfigStore'
import type { HookRunner, RunHookHandlerRequest } from './hookRunner'
import type { HookAggregateResult, HookEvent, HookHandlerExecution, HookInput, HookMatcherGroup, IHookDispatcher, NormalizedHookDecision, ResolvedHookGroup } from './types'
import { emptyHookResult, normalizeDecision } from './types'

export interface HookDispatcherOptions {
  store: HookConfigStore
  runner: HookRunner
  logger?: ILogger
}

/**
 * 事件分发：matcher 过滤、并发执行、结果聚合。
 *
 * 聚合：任一 deny → deny；否则任一 ask → ask；否则任一显式 allow → allow；
 * 全部无决策 → undefined（不干预主流程）。
 * global 与 workspace 的匹配项都执行。
 */
export function createHookDispatcher(options: HookDispatcherOptions): IHookDispatcher {
  const { store, runner } = options

  return {
    async run(event, input, dispatchOptions) {
      const groups = store.resolveForEvent(event, dispatchOptions.cwd)
      const jobs = collectJobs(event, input, groups)
      if (jobs.length === 0)
        return emptyHookResult(event)

      const executions = await Promise.all(jobs.map(job =>
        runner.runHandler({
          event,
          source: job.source,
          handler: job.handler,
          input,
          cwd: dispatchOptions.cwd,
          signal: dispatchOptions.signal,
        } satisfies RunHookHandlerRequest),
      ))
      return aggregate(event, executions)
    },
  }
}

interface HookJob {
  source: ResolvedHookGroup['source']
  handler: HookMatcherGroup['hooks'][number]
}

function collectJobs(event: HookEvent, input: HookInput, groups: ResolvedHookGroup[]): HookJob[] {
  const jobs: HookJob[] = []
  const target = resolveMatcherTarget(event, input)
  for (const { source, group } of groups) {
    if (!matchesMatcher(group.matcher, target))
      continue
    for (const handler of group.hooks)
      jobs.push({ source, handler })
  }
  return jobs
}

/**
 * matcher 的匹配目标按事件取主键；省略或 `*` 匹配全部。
 * 无匹配目标的事件在给出具体 matcher 时不匹配，避免误伤。
 */
function resolveMatcherTarget(event: HookEvent, input: HookInput): string | undefined {
  switch (event) {
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PermissionRequest':
      return typeof input.tool_name === 'string' ? input.tool_name : undefined
    case 'Notification':
      return typeof input.type === 'string' ? input.type : undefined
    case 'SessionStart':
      return typeof input.source === 'string' ? input.source : undefined
    case 'UserPromptSubmit':
      return typeof input.prompt === 'string' ? input.prompt : undefined
    case 'PreCompact':
    case 'PostCompact':
      return typeof input.trigger === 'string' ? input.trigger : undefined
    default:
      return undefined
  }
}

function matchesMatcher(matcher: string | undefined, target: string | undefined): boolean {
  if (matcher === undefined || matcher === '' || matcher === '*')
    return true
  if (target === undefined)
    return false
  try {
    return new RegExp(matcher).test(target)
  }
  catch {
    // 无效 regex 视为不匹配，并保持主流程可用。
    return false
  }
}

function aggregate(event: HookEvent, executions: HookHandlerExecution[]): HookAggregateResult {
  let decision: NormalizedHookDecision | undefined
  let reason: string | undefined
  let continueFlag: boolean | undefined
  const contexts: string[] = []

  for (const execution of executions) {
    const normalized = normalizeDecision(execution.decision)
    if (normalized) {
      if (rank(normalized) > rank(decision)) {
        decision = normalized
        reason = execution.reason
      }
      else if (rank(normalized) === rank(decision) && !reason) {
        reason = execution.reason
      }
    }
    if (execution.continue === false)
      continueFlag = false
    else if (execution.continue === true && continueFlag === undefined)
      continueFlag = true
    if (execution.additionalContext)
      contexts.push(execution.additionalContext)
  }

  const result: HookAggregateResult = { event, executions }
  if (decision)
    result.decision = decision
  if (reason)
    result.reason = reason
  if (continueFlag !== undefined)
    result.continue = continueFlag
  if (contexts.length > 0)
    result.additionalContext = contexts.join('\n')
  return result
}

function rank(decision: NormalizedHookDecision | undefined): number {
  if (decision === 'deny')
    return 3
  if (decision === 'ask')
    return 2
  if (decision === 'allow')
    return 1
  return 0
}
