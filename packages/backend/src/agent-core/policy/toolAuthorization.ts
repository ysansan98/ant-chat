import type { AgentErrorCode, AgentMode, AgentPendingAction, BashToolInput, PolicyBasis, ToolApprovalWhitelistEntry, ToolOperationType, ToolScope } from '@ant-chat/shared'
import type { TaskStore } from '../taskStore'
import type { ToolAuthorization } from '../tools/types'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { AgentError } from '../AgentError'
import { normalizeCandidatePath } from '../native-tools/pathPolicy'
import { createBashApprovalTarget } from '../native-tools/tools/bashRunner'
import { cancelObservation, completeObservation, failObservation, startObservationSpan } from '../observation'

export function createToolAuthorization(
  taskStore: TaskStore,
  grants: {
    getEntries?: () => ToolApprovalWhitelistEntry[]
  } = {},
): ToolAuthorization {
  return async (input) => {
    const { task, prepared, config, parentSpanId } = input

    const isAutomationTurn = task.snapshot.turnSource?.type === 'automation'
    const automationDecision = decideAutomationPolicy(
      task.snapshot.turnSource?.type === 'automation'
        ? task.snapshot.turnSource.permissionPolicy
        : undefined,
      prepared.input,
      prepared.operationType,
      prepared.scope,
    )
    // 自动化 turn 的权限决策是自治的、穷举的，不回退到交互策略。
    // 如果自动化策略未覆盖某个 operationType（包括 permissionPolicy 缺失），
    // 视为拒绝而非"需审批"——因为没有人可以审批。
    const effectiveDecision = isAutomationTurn
      ? (automationDecision ?? { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未配置权限策略或操作类型不支持', basis: 'automation.no-policy' as const })
      : (automationDecision ?? decidePolicy(task.snapshot.mode, prepared.operationType, prepared.scope))

    const policySpan = startObservationSpan(config, recorder => recorder.startPolicyDecision({
      toolName: prepared.toolName,
      input: prepared.input,
      operationType: prepared.operationType,
      scope: prepared.scope,
      policy: effectiveDecision.type,
      basis: effectiveDecision.basis,
      initialDecision: { outcome: effectiveDecision.type, basis: effectiveDecision.basis },
      mode: task.snapshot.mode,
      automationPolicy: task.snapshot.turnSource?.type === 'automation' ? task.snapshot.turnSource.permissionPolicy : undefined,
      workspacePath: task.snapshot.workspacePath,
      step: input.step,
      toolCallId: input.toolCallId,
    }, parentSpanId))

    if (effectiveDecision.type === 'allow') {
      completeObservation(policySpan, { status: 'allow', outcome: 'allow', effectiveDecision: { outcome: 'allow', basis: effectiveDecision.basis } }, config.logger)
      return { outcome: 'allow' }
    }

    if (effectiveDecision.type === 'block') {
      completeObservation(policySpan, { status: 'block', outcome: 'block', effectiveDecision: { outcome: 'block', basis: effectiveDecision.basis }, errorCode: effectiveDecision.errorCode, reason: effectiveDecision.reason }, config.logger)
      return {
        outcome: 'block',
        errorCode: effectiveDecision.errorCode,
        reason: effectiveDecision.reason,
      }
    }

    // 记忆授权只能满足“需要审批”，不能覆盖 block。
    if (grants.getEntries) {
      try {
        const matchKey = extractInputKey(prepared.toolName, prepared.input, task.snapshot.workspacePath, config.bashEnvironment?.PATH)
        const entries = grants.getEntries()
        const matched = isWhitelisted(
          entries,
          prepared.toolName,
          prepared.operationType,
          prepared.scope,
          matchKey,
          task.snapshot.workspacePath,
        )
        if (matched) {
          completeObservation(policySpan, {
            status: 'allow',
            outcome: 'allow',
            effectiveDecision: { outcome: 'allow', basis: 'approval-grant.match' },
            whitelist: { matchKey, entry: matched },
          }, config.logger)
          return { outcome: 'allow' }
        }
      }
      catch (error) {
        failObservation(policySpan, error, config.logger)
        throw error
      }
    }

    const approvalGrant = createApprovalGrant(
      prepared.toolName,
      prepared.input,
      prepared.operationType,
      prepared.scope,
      task.snapshot.workspacePath,
      config.bashEnvironment?.PATH,
    )
    const pendingAction: AgentPendingAction = {
      actionId: randomUUID(),
      toolName: prepared.toolName,
      operationType: prepared.operationType,
      scope: prepared.scope,
      inputPreview: JSON.stringify(prepared.input).slice(0, 200),
      approvalGrant,
      createdAt: Date.now(),
    }
    let decisionResult: Awaited<ReturnType<TaskStore['requestApproval']>>
    try {
      decisionResult = await taskStore.requestApproval(task, pendingAction, config.eventEmitter)
    }
    catch (error) {
      failObservation(policySpan, error, config.logger)
      throw error
    }
    if (
      task.abortController.signal.aborted
      || decisionResult.reason === 'AGENT_CANCELLED'
    ) {
      cancelObservation(policySpan, 'AGENT_CANCELLED', config.logger)
      throw new AgentError('AGENT_CANCELLED', '任务已取消')
    }

    if (!decisionResult.approved) {
      const reason = `Tool ${prepared.toolName} rejected: ${decisionResult.reason || 'no reason given'}`
      completeObservation(policySpan, {
        status: 'approval',
        outcome: 'block',
        effectiveDecision: { outcome: 'block', basis: 'approval.user-rejected' },
        approval: { approved: false, pendingAction, reason: decisionResult.reason },
      }, config.logger)
      return {
        outcome: 'block',
        errorCode: decisionResult.reason || 'AGENT_APPROVAL_REJECTED',
        reason,
      }
    }

    completeObservation(policySpan, {
      status: 'approval',
      outcome: 'allow',
      effectiveDecision: { outcome: 'allow', basis: 'approval.user-approved' },
      approval: { approved: true, pendingAction, remember: decisionResult.remember },
    }, config.logger)
    return { outcome: 'allow' }
  }
}

function decideAutomationPolicy(
  policy: import('@ant-chat/shared').AutomationPermissionPolicy | undefined,
  input: Record<string, unknown>,
  operationType: import('@ant-chat/shared').ToolOperationType,
  scope: import('@ant-chat/shared').ToolScope,
): PolicyDecision | undefined {
  if (!policy)
    return undefined
  if (scope === 'blocked')
    return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '策略阻断，禁止执行', basis: 'scope.blocked' as const }
  if (!hasValidResourceDomain(operationType, scope))
    return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '工具能力与资源域不一致', basis: 'scope.blocked' as const }

  // MCP 服务端无法提供可验证的副作用保证；ToolAnnotations 只能作为提示。
  // ToolRegistry 先按所选服务和显式能力开关缩小集合，这里保留安全默认拒绝。
  if (operationType === 'mcp') {
    return policy.allowMcpTools
      ? { type: 'allow' as const, basis: 'automation.mcp.allow' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未授权 MCP 工具', basis: 'automation.mcp.blocked' as const }
  }

  if (operationType === 'browser') {
    if (scope === 'outside')
      return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务不允许复用系统浏览器身份', basis: 'automation.browser-profile.blocked' as const }
    return policy.allowBrowser
      ? { type: 'allow' as const, basis: 'automation.browser.allow' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未授权浏览器操作', basis: 'automation.browser.blocked' as const }
  }

  if (scope !== 'workspace')
    return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务不允许访问工作区外资源', basis: 'automation.scope.blocked' as const }
  if (operationType === 'read')
    return { type: 'allow' as const, basis: 'automation.read.allow' as const }
  if (operationType === 'write') {
    return policy.workspaceAccess === 'write'
      ? { type: 'allow' as const, basis: 'automation.write.allow' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务仅有工作区读取权限', basis: 'automation.write.blocked' as const }
  }
  if (operationType === 'skill') {
    // Skill 能力已由当前 Turn 的 ToolRegistry 最小化注入，权限层不再重复维护白名单。
    return { type: 'allow' as const, basis: 'automation.skill.allow' as const }
  }
  if (operationType === 'bash_read') {
    return policy.allowBashCommands
      ? { type: 'allow' as const, basis: 'automation.bash-read.allow' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未授权命令执行', basis: 'automation.bash-read.blocked' as const }
  }
  if (operationType === 'bash') {
    if (!policy.allowBashCommands)
      return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未授权命令执行', basis: 'automation.bash.blocked' as const }
    if (policy.bashCommandPatterns.length === 0)
      return { type: 'allow' as const, basis: 'automation.bash.allow' as const }
    const matchKey = String(input.command ?? '')
    return policy.bashCommandPatterns.some(pattern => matchPattern(pattern, matchKey))
      ? { type: 'allow' as const, basis: 'automation.bash.pattern-match' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '命令不在自动化任务允许范围内', basis: 'automation.bash.pattern-blocked' as const }
  }
  // 未知 operationType — 安全默认拒绝。不在自动化策略中显式支持的操作一律不允许。
  return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: `自动化任务不支持该操作类型: ${operationType}`, basis: 'automation.unsupported' as const }
}

type PolicyDecision
  = | { type: 'allow', basis: PolicyBasis }
    | { type: 'require_approval', basis: PolicyBasis }
    | { type: 'block', errorCode: AgentErrorCode, reason: string, basis: PolicyBasis }

function decidePolicy(mode: AgentMode, operationType: ToolOperationType, scope: ToolScope): PolicyDecision {
  if (scope === 'blocked') {
    return { type: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: '策略阻断，禁止执行', basis: 'scope.blocked' }
  }
  if (!hasValidResourceDomain(operationType, scope)) {
    return { type: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: '工具能力与资源域不一致', basis: 'scope.blocked' }
  }

  // 完全访问只跳过人工审批，不能覆盖工具或系统产生的硬阻断。
  if (mode === 'full_managed') {
    return { type: 'allow', basis: 'mode.full-managed' }
  }

  if (scope === 'outside' || scope === 'external') {
    return { type: 'require_approval', basis: scope === 'external' ? 'scope.external' : 'scope.outside' }
  }

  // 其余情况仅会是 workspace scope。
  if (operationType === 'read' || operationType === 'bash_read' || operationType === 'skill') {
    return { type: 'allow', basis: 'workspace.read' }
  }

  if (mode === 'hybrid' && operationType === 'write') {
    return { type: 'allow', basis: 'hybrid.write' }
  }

  return { type: 'require_approval', basis: 'default.require-approval' }
}

function hasValidResourceDomain(operationType: ToolOperationType, scope: ToolScope): boolean {
  if (operationType === 'mcp')
    return scope === 'external'
  if (operationType === 'browser')
    return scope === 'external' || scope === 'outside'
  return true
}

const FILE_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'glob_files',
  'grep_files',
])

function extractInputKey(toolName: string, input: Record<string, unknown>, workspacePath: string, executableSearchPath?: string): string {
  if (toolName === 'bash') {
    return createBashApprovalTarget(input as unknown as BashToolInput, workspacePath, executableSearchPath)?.key ?? ''
  }
  if (FILE_TOOLS.has(toolName)) {
    return normalizeInputKey(toolName, String(input.path ?? '.'), workspacePath)
  }
  if (toolName === 'use_skill' || toolName === 'install_skill_from_github') {
    return String(input.name ?? '')
  }
  return stableStringify(input)
}

function createApprovalGrant(
  toolName: string,
  input: Record<string, unknown>,
  operationType: ToolOperationType,
  toolScope: ToolScope,
  workspacePath: string,
  executableSearchPath?: string,
): ToolApprovalWhitelistEntry | undefined {
  if (toolScope === 'blocked') {
    return undefined
  }
  if (toolName === 'bash') {
    const target = createBashApprovalTarget(input as unknown as BashToolInput, workspacePath, executableSearchPath)
    return target
      ? { toolName, operationType, toolScope, pattern: target.key, description: target.description }
      : undefined
  }

  const pattern = extractInputKey(toolName, input, workspacePath, executableSearchPath)
  const description = FILE_TOOLS.has(toolName)
    ? `允许 ${toolName} 访问 ${String(input.path ?? '.')}`
    : toolName === 'use_skill' || toolName === 'install_skill_from_github'
      ? `允许 ${toolName} 使用 ${pattern}`
      : `允许 ${toolName} 使用当前输入`
  return { toolName, operationType, toolScope, pattern, description }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
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

  const absoluteInput = path.isAbsolute(inputKey) ? path.resolve(inputKey) : path.resolve(workspacePath, inputKey)
  return normalizeCandidatePath(absoluteInput)
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
  operationType: ToolOperationType,
  toolScope: ToolScope,
  inputKey: string,
  currentWorkspace?: string,
): ToolApprovalWhitelistEntry | undefined {
  return entries.find((entry) => {
    if (entry.toolName !== toolName || entry.operationType !== operationType || entry.toolScope !== toolScope)
      return false

    if (entry.workspacePath !== undefined) {
      if (entry.workspacePath !== currentWorkspace)
        return false
    }

    return entry.pattern === inputKey
  })
}
