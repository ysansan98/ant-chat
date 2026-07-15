import type { AgentErrorCode, AgentMode, AgentPendingAction, ToolApprovalWhitelistEntry, ToolOperationType, ToolScope } from '@ant-chat/shared'
import type { TaskStore } from '../taskStore'
import type { ToolAuthorization } from '../tools/types'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { AgentError } from '../AgentError'
import { createAgentTraceLogger } from '../agentTraceLogger'

export function createToolAuthorization(
  taskStore: TaskStore,
  getWhitelistEntries?: () => ToolApprovalWhitelistEntry[],
): ToolAuthorization {
  return async (input) => {
    const { task, prepared, config, onToolCallContext } = input
    const traceLogger = createAgentTraceLogger(config)
    const logContext = {
      runId: task.snapshot.taskId,
      taskId: task.snapshot.taskId,
      conversationId: task.snapshot.conversationId,
      userMessageId: task.snapshot.userMessageId,
      step: input.step,
      toolCallId: input.toolCallId,
    }

    const isAutomationTurn = task.snapshot.turnSource?.type === 'automation'
    const automationDecision = decideAutomationPolicy(
      task.snapshot.turnSource?.type === 'automation'
        ? task.snapshot.turnSource.permissionPolicy
        : undefined,
      prepared.toolName,
      prepared.input,
      prepared.operationType,
      prepared.scope,
      task.snapshot.workspacePath,
    )
    // 自动化 turn 的权限决策是自治的、穷举的，不回退到交互策略。
    // 如果自动化策略未覆盖某个 operationType（包括 permissionPolicy 缺失），
    // 视为拒绝而非"需审批"——因为没有人可以审批。
    const effectiveDecision = isAutomationTurn
      ? (automationDecision ?? { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未配置权限策略或操作类型不支持' })
      : (automationDecision ?? decidePolicy(task.snapshot.mode, prepared.operationType, prepared.scope))

    const context = {
      toolName: prepared.toolName,
      input: prepared.input,
      operationType: prepared.operationType,
      scope: prepared.scope,
      policy: effectiveDecision.type,
    }
    onToolCallContext?.(context)

    traceLogger.write('tool_decision', {
      ...logContext,
      toolName: prepared.toolName,
      input: prepared.input,
      operationType: prepared.operationType,
      scope: prepared.scope,
      policy: effectiveDecision.type,
      workspacePath: task.snapshot.workspacePath,
    })

    if (effectiveDecision.type === 'allow') {
      return { outcome: 'allow' }
    }

    if (effectiveDecision.type === 'block') {
      return {
        outcome: 'block',
        errorCode: effectiveDecision.errorCode,
        reason: effectiveDecision.reason,
      }
    }

    // require_approval — check whitelist before showing dialog
    if (getWhitelistEntries) {
      const matchKey = extractInputKey(prepared.toolName, prepared.input)
      const entries = getWhitelistEntries()
      const matched = isWhitelisted(
        entries,
        prepared.toolName,
        prepared.scope,
        matchKey,
        task.snapshot.workspacePath,
      )
      if (matched) {
        traceLogger.write('tool_whitelist_auto_approved', {
          ...logContext,
          toolName: prepared.toolName,
          scope: prepared.scope,
          matchKey,
          pattern: matched.pattern,
          workspacePath: task.snapshot.workspacePath,
        })
        return { outcome: 'allow' }
      }
    }

    // require_approval
    const whitelistPattern = generatePattern(
      prepared.toolName,
      prepared.input,
      prepared.scope,
      task.snapshot.workspacePath,
    )
    const pendingAction: AgentPendingAction = {
      actionId: randomUUID(),
      toolName: prepared.toolName,
      operationType: prepared.operationType,
      scope: prepared.scope,
      inputPreview: JSON.stringify(prepared.input).slice(0, 200),
      whitelistPattern,
      createdAt: Date.now(),
    }
    const decisionResult = await taskStore.requestApproval(task, pendingAction, config.eventEmitter)
    if (
      task.abortController.signal.aborted
      || decisionResult.reason === 'AGENT_CANCELLED'
    ) {
      throw new AgentError('AGENT_CANCELLED', 'Task cancelled')
    }

    if (!decisionResult.approved) {
      return {
        outcome: 'block',
        errorCode: decisionResult.reason || 'AGENT_APPROVAL_REJECTED',
        reason: `Tool ${prepared.toolName} rejected: ${decisionResult.reason || 'no reason given'}`,
      }
    }

    return { outcome: 'allow' }
  }
}

function decideAutomationPolicy(
  policy: import('@ant-chat/shared').AutomationPermissionPolicy | undefined,
  toolName: string,
  input: Record<string, unknown>,
  operationType: import('@ant-chat/shared').ToolOperationType,
  scope: import('@ant-chat/shared').ToolScope,
  workspacePath: string,
) {
  if (!policy)
    return undefined
  if (scope !== 'workspace')
    return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务不允许访问工作区外资源' }
  if (operationType === 'read')
    return { type: 'allow' as const }
  if (operationType === 'browser')
    return { type: 'allow' as const }
  if (operationType === 'write') {
    return policy.workspaceAccess === 'write'
      ? { type: 'allow' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务仅有工作区读取权限' }
  }
  if (operationType === 'skill') {
    // Skill 能力已由当前 Turn 的 ToolRegistry 最小化注入，权限层不再重复维护白名单。
    return { type: 'allow' as const }
  }
  if (operationType === 'mcp') {
    return policy.allowMcpMutations
      ? { type: 'allow' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未授权 MCP 操作' }
  }
  if (operationType === 'bash') {
    if (!policy.allowBashCommands)
      return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未授权命令执行' }
    if (policy.bashCommandPatterns.length === 0)
      return { type: 'allow' as const }
    const matchKey = extractInputKey(toolName, input)
    const entries = policy.bashCommandPatterns.map(pattern => ({ toolName, toolScope: scope, pattern, workspacePath }))
    return isWhitelisted(entries, toolName, scope, matchKey, workspacePath)
      ? { type: 'allow' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '命令不在自动化任务允许范围内' }
  }
  // 未知 operationType — 安全默认拒绝。不在自动化策略中显式支持的操作一律不允许。
  return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: `自动化任务不支持该操作类型: ${operationType}` }
}

type PolicyDecision
  = | { type: 'allow' }
    | { type: 'require_approval' }
    | { type: 'block', errorCode: AgentErrorCode, reason: string }

function decidePolicy(mode: AgentMode, operationType: ToolOperationType, scope: ToolScope): PolicyDecision {
  if (mode === 'full_managed') {
    return { type: 'allow' }
  }

  if (scope === 'blocked') {
    return { type: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: '策略阻断，禁止执行' }
  }

  if (scope === 'outside') {
    return { type: 'require_approval' }
  }

  // 其余情况仅会是 workspace scope。
  if (operationType === 'read' || operationType === 'browser' || operationType === 'skill' || operationType === 'mcp') {
    return { type: 'allow' }
  }

  if (mode === 'hybrid' && operationType === 'write') {
    return { type: 'allow' }
  }

  return { type: 'require_approval' }
}

const FILE_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'glob_files',
  'grep_files',
])

function extractInputKey(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'bash') {
    return String(input.command ?? '')
  }
  if (FILE_TOOLS.has(toolName)) {
    return String(input.path ?? '')
  }
  if (toolName === 'use_skill' || toolName === 'install_skill_from_github') {
    return String(input.name ?? '')
  }
  return ''
}

function generatePattern(
  toolName: string,
  input: Record<string, unknown>,
  toolScope: ToolScope,
  workspacePath?: string,
): string {
  if (toolName === 'bash') {
    const cmd = String(input.command ?? '')
    const firstWord = cmd.split(/\s+/)[0] ?? ''
    return firstWord ? `${firstWord} **` : cmd
  }

  if (FILE_TOOLS.has(toolName)) {
    const filePath = String(input.path ?? '')
    if (!filePath) {
      return '*'
    }

    if (toolScope === 'workspace' && workspacePath) {
      try {
        const relative = path.relative(workspacePath, filePath)
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
          const dir = path.dirname(relative)
          return dir === '.' ? './**' : `.${path.sep}${dir}${path.sep}**`
        }
      }
      catch {
        // 无法生成相对路径时，回退到绝对路径。
      }
    }

    // 工作区外或未提供工作区时，按绝对路径目录匹配。
    const dir = path.dirname(filePath)
    return `${dir}${path.sep}**`
  }

  if (toolName === 'use_skill' || toolName === 'install_skill_from_github') {
    return extractInputKey(toolName, input)
  }
  // MCP 和未知工具只能按工具名加入白名单，统一建议匹配所有输入。
  return '*'
}

function normalizeInputKey(
  toolName: string,
  inputKey: string,
  workspacePath?: string,
): string {
  if (!workspacePath)
    return inputKey
  if (!FILE_TOOLS.has(toolName))
    return inputKey

  try {
    const relative = path.relative(workspacePath, inputKey)
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative === '.' ? '.' : `.${path.sep}${relative}`
    }
  }
  catch {
    // Windows 跨盘符时 path.relative 可能抛错，保留原始输入。
  }

  return inputKey
}

function globToRegex(pattern: string): RegExp {
  let regexStr = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      regexStr += '.*'
      i += 2
    }
    else if (pattern[i] === '*') {
      regexStr += '[^/]*'
      i += 1
    }
    else {
      regexStr += escapeRegex(pattern[i]!)
      i += 1
    }
  }
  return new RegExp(`^${regexStr}$`, 's')
}

function escapeRegex(char: string): string {
  const specials = '.+?^${}()|[]\\'
  return specials.includes(char) ? `\\${char}` : char
}

function matchPattern(pattern: string, inputKey: string): boolean {
  return globToRegex(pattern).test(inputKey)
}

function isWhitelisted(
  entries: ToolApprovalWhitelistEntry[],
  toolName: string,
  toolScope: ToolScope,
  inputKey: string,
  currentWorkspace?: string,
): ToolApprovalWhitelistEntry | undefined {
  const normalizedKey = normalizeInputKey(toolName, inputKey, currentWorkspace)

  return entries.find((entry) => {
    if (entry.toolName !== toolName || entry.toolScope !== toolScope)
      return false

    if (entry.workspacePath !== undefined) {
      if (entry.workspacePath !== currentWorkspace)
        return false
    }

    return matchPattern(entry.pattern, normalizedKey)
  })
}
