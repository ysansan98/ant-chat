import type { AgentErrorCode, AgentMode, AgentPendingAction, ApprovalCandidate, ApprovalGrantCandidates, BrowserRule, CommandRule, FilesystemRule, McpToolRule, PolicyBasis, ToolApprovalRule, ToolOperationType, ToolScope } from '@ant-chat/shared'
import type { PreparedCommandSegment, PreparedCommandState } from '../native-tools/command/types'
import type { TaskStore } from '../taskStore'
import type { PreparedToolCall } from '../tools/toolRegistry'
import type { ToolAuthorization } from '../tools/types'
import { randomUUID } from 'node:crypto'
import { AgentError } from '../AgentError'
import { isPreparedCommandState } from '../native-tools/command/types'
import { buildFileResource, createFilesystemCandidate, FILE_TOOLS, matchFilesystemRule } from '../native-tools/tools/fileResourceBuilder'
import { cancelObservation, completeObservation, failObservation, startObservationSpan } from '../observation'

/**
 * 工具授权裁决。
 *
 * 权限规则只参与交互审批：
 * - 基础策略 allow / require_approval / block
 * - 仅 require_approval 时查询权限规则
 * - 命中则 allow，否则等待用户审批
 *
 * 详见 docs/adr/0001-tool-approval-rules.md §1。
 */
export function createToolAuthorization(
  taskStore: TaskStore,
  grants: {
    getRules?: (workspacePath: string) => { global: ToolApprovalRule[], workspace: ToolApprovalRule[] }
  } = {},
): ToolAuthorization {
  return async (input) => {
    const { task, prepared, config, parentSpanId } = input

    const isAutomationTurn = task.snapshot.turnSource?.type === 'automation'
    const commandState = isPreparedCommandState(prepared.preparedState)
      ? prepared.preparedState
      : undefined
    const automationDecision = decideAutomationPolicy(
      task.snapshot.turnSource?.type === 'automation'
        ? task.snapshot.turnSource.permissionPolicy
        : undefined,
      prepared.input,
      prepared.operationType,
      prepared.scope,
    )
    const requiresSingleUseApproval = commandState?.risk === 'requires_approval'
      || commandState?.hasSecretEnv === true
    // 自动化 turn 的权限决策是自治的、穷举的，不回退到交互策略。
    let effectiveDecision: PolicyDecision = commandState?.risk === 'bottomline_block'
      ? {
          type: 'block',
          errorCode: 'AGENT_POLICY_BLOCKED',
          reason: commandState.riskReason || '命令命中不可覆盖的底线保护',
          basis: 'command.bottomline-block',
        }
      : isAutomationTurn
        ? (automationDecision ?? { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未配置权限策略或操作类型不支持', basis: 'automation.no-policy' as const })
        : requiresSingleUseApproval
          ? task.snapshot.mode === 'full_managed'
            ? { type: 'allow' as const, basis: 'mode.full-managed' as const }
            : { type: 'require_approval' as const, basis: 'command.risk.require-approval' as const }
          : (automationDecision ?? decidePolicy(task.snapshot.mode, prepared.operationType, prepared.scope))

    const policySpan = startObservationSpan(config, recorder => recorder.startPolicyDecision({
      toolName: prepared.toolName,
      input: prepared.input,
      interpreter: commandState?.interpreter,
      command: commandState
        ? {
            interpreter: commandState.interpreter,
            risk: commandState.risk,
            riskReason: commandState.riskReason,
          }
        : undefined,
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

    // 黑名单是用户明确收紧的能力边界，必须在基础 allow/full_managed 与白名单前裁决。
    // 白名单仍只参与交互 Turn；黑名单对自动化同样生效，避免无人值守绕过显式禁止。
    let ruleGroups: ReturnType<NonNullable<typeof grants.getRules>> | undefined
    if (grants.getRules) {
      try {
        ruleGroups = grants.getRules(task.snapshot.workspacePath)
      }
      catch (error) {
        const readSpan = startObservationSpan(config, recorder => recorder.startPolicyDecision({
          toolName: prepared.toolName,
          input: { phase: 'approval-rule-read' },
          operationType: prepared.operationType,
          scope: prepared.scope,
          policy: 'require_approval',
          basis: 'approval.rule-read-failed',
          initialDecision: { outcome: 'require_approval', basis: effectiveDecision.basis },
          mode: task.snapshot.mode,
          workspacePath: task.snapshot.workspacePath,
          step: input.step,
          toolCallId: input.toolCallId,
        }, policySpan?.id || parentSpanId))
        failObservation(readSpan, error, config.logger)
        config.logger?.warn('权限规则读取失败，当前工具调用继续进入人工审批', error)
        // ADR-0001 §2: 权限文件读取失败时 deny 规则不可验证，不能自动执行。
        // - 交互 Turn：allow 降级为 require_approval，进入人工审批。
        // - 自动化 Turn：无人值守，无审批环节，allow 降级为 block，中断任务。
        if (effectiveDecision.type === 'allow') {
          effectiveDecision = isAutomationTurn
            ? { type: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason: '权限文件读取失败，无法验证 deny 规则，自动化任务已中断', basis: 'approval.rule-read-failed' }
            : { type: 'require_approval', basis: 'approval.rule-read-failed' }
        }
      }
    }

    if (ruleGroups) {
      const { global, workspace } = ruleGroups
      const allRules = [...global, ...workspace]
      const denied = matchRulesAgainstToolCall(allRules.filter(isDenyRule), prepared, task.snapshot.workspacePath)[0]
      if (denied) {
        const isGlobal = global.includes(denied)
        const reason = `已被权限黑名单阻止：${describePermissionRule(denied)}`
        completeObservation(policySpan, {
          status: 'block',
          outcome: 'block',
          effectiveDecision: { outcome: 'block', basis: 'approval-rule.deny-match' },
          permissionRules: [{ ruleId: denied.id, kind: denied.kind, effect: 'deny', group: isGlobal ? 'global' : 'workspace' }],
          reason,
        }, config.logger)
        return { outcome: 'block', errorCode: 'AGENT_POLICY_BLOCKED', reason, continueAgent: true }
      }
    }

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

    // 白名单只能满足交互 Turn 的 require_approval，不能覆盖黑名单或系统阻断。
    if (ruleGroups && !isAutomationTurn && !requiresSingleUseApproval) {
      const { global, workspace } = ruleGroups
      const matched = matchRulesAgainstToolCall(
        [...global, ...workspace].filter(rule => !isDenyRule(rule)),
        prepared,
        task.snapshot.workspacePath,
      )
      if (matched.length > 0) {
        completeObservation(policySpan, {
          status: 'allow',
          outcome: 'allow',
          effectiveDecision: { outcome: 'allow', basis: 'approval-grant.match' },
          permissionRules: matched.map(rule => ({
            ruleId: rule.id,
            kind: rule.kind,
            effect: 'allow',
            group: global.includes(rule) ? 'global' : 'workspace',
          })),
        }, config.logger)
        return { outcome: 'allow' }
      }
    }

    // 生成审批候选
    const approvalCandidates = createApprovalCandidates(
      prepared,
      task.snapshot.workspacePath,
      ruleGroups
        ? [...ruleGroups.global, ...ruleGroups.workspace].filter((rule): rule is CommandRule => rule.kind === 'command' && !isDenyRule(rule))
        : [],
    )

    const pendingAction: AgentPendingAction = {
      actionId: randomUUID(),
      toolName: prepared.toolName,
      operationType: prepared.operationType,
      scope: prepared.scope,
      inputPreview: JSON.stringify(prepared.input).slice(0, 200),
      approvalCandidates: approvalCandidates ?? undefined,
      createdAt: Date.now(),
    }
    let decisionResult: Awaited<ReturnType<TaskStore['requestApproval']>>
    try {
      decisionResult = await taskStore.requestApproval(
        task,
        pendingAction,
        config.eventEmitter,
        (error) => {
          const persistenceSpan = startObservationSpan(config, recorder => recorder.startPolicyDecision({
            toolName: prepared.toolName,
            input: {
              phase: 'approval-rule-persistence',
              actionId: pendingAction.actionId,
            },
            operationType: prepared.operationType,
            scope: prepared.scope,
            policy: 'block',
            basis: 'approval.persistence-failed',
            initialDecision: { outcome: 'block', basis: 'approval.persistence-failed' },
            mode: task.snapshot.mode,
            workspacePath: task.snapshot.workspacePath,
            step: input.step,
            toolCallId: input.toolCallId,
          }, policySpan?.id || parentSpanId))
          failObservation(persistenceSpan, error, config.logger)
        },
      )
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
      const reason = `用户拒绝执行工具 ${prepared.toolName}${decisionResult.reason ? `：${decisionResult.reason}` : ''}`
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
      approval: { approved: true, pendingAction, selection: decisionResult.selection },
    }, config.logger)
    return { outcome: 'allow' }
  }
}

// ---- 规则匹配 ----

function matchRulesAgainstToolCall(
  rules: ToolApprovalRule[],
  prepared: PreparedToolCall,
  workspacePath: string,
): ToolApprovalRule[] {
  if (isPreparedCommandState(prepared.preparedState)) {
    return matchCommandRules(rules, prepared.preparedState)
  }

  if (FILE_TOOLS.has(prepared.toolName)) {
    const matched = matchFilesystemRules(rules, prepared.toolName, prepared.input, workspacePath)
    return matched ? [matched] : []
  }

  if (prepared.operationType === 'mcp' && prepared.originalToolName && prepared.serverName) {
    const matched = matchMcpRules(rules, prepared.serverName, prepared.originalToolName)
    return matched ? [matched] : []
  }

  if (prepared.operationType === 'browser') {
    const matched = matchBrowserRules(rules, prepared)
    return matched ? [matched] : []
  }

  // 未知工具不生成持久规则候选
  return []
}

function isDenyRule(rule: ToolApprovalRule): boolean {
  return rule.effect === 'deny'
}

function describePermissionRule(rule: ToolApprovalRule): string {
  if (rule.kind === 'command') {
    return [rule.executable, ...rule.argvPrefix].join(' ') || rule.executable
  }
  if (rule.kind === 'filesystem') {
    return `${rule.access === 'read' ? '读取' : '写入'} ${rule.canonicalPath}`
  }
  if (rule.kind === 'mcp-tool') {
    return `${rule.serverName} → ${rule.toolName}`
  }
  return `${rule.toolName}${rule.urlPattern ? ` (${rule.urlPattern})` : ''}`
}

function matchCommandRules(
  rules: ToolApprovalRule[],
  prepared: PreparedCommandState,
): CommandRule[] {
  const commandRules = rules.filter((rule): rule is CommandRule =>
    rule.kind === 'command' && rule.interpreter === prepared.interpreter,
  )
  if (commandRules.length === 0) {
    return []
  }
  if (prepared.risk === 'bottomline_block' || prepared.segments.length === 0) {
    return []
  }
  if (commandRules.every(isDenyRule)) {
    const denied = commandRules.find(rule =>
      prepared.segments.some(segment => matchCommandSegment(segment, rule)),
    )
    return denied ? [denied] : []
  }
  const executableSegments = prepared.segments.filter(segment => !segment.isCd)
  if (executableSegments.every(segment => commandRules.some(rule => matchCommandSegment(segment, rule)))) {
    const matched = new Set<CommandRule>()
    for (const segment of executableSegments) {
      const rule = commandRules.find(candidate => matchCommandSegment(segment, candidate))
      if (rule)
        matched.add(rule)
    }
    return [...matched]
  }
  return []
}

function matchCommandSegment(segment: PreparedCommandSegment, rule: CommandRule): boolean {
  return segment.resourceScope === rule.resourceScope
    && segment.executable === rule.executable
    && rule.argvPrefix.every((arg, index) => arg === segment.args[index])
    && (rule.allowRemainingArgs || rule.argvPrefix.length === segment.args.length)
}

function matchFilesystemRules(
  rules: ToolApprovalRule[],
  toolName: string,
  input: Record<string, unknown>,
  workspacePath: string,
): FilesystemRule | undefined {
  const fsRules = rules.filter((r): r is FilesystemRule => r.kind === 'filesystem')
  if (fsRules.length === 0) {
    return undefined
  }
  const resource = buildFileResource(toolName, input, workspacePath)
  if (!resource) {
    return undefined
  }
  return fsRules.find(rule => matchFilesystemRule(resource, rule))
}

function matchMcpRules(
  rules: ToolApprovalRule[],
  serverName: string,
  originalToolName: string,
): McpToolRule | undefined {
  return rules.find((rule): rule is McpToolRule =>
    rule.kind === 'mcp-tool'
    && rule.serverName === serverName
    && rule.toolName === originalToolName,
  )
}

function matchBrowserRules(
  rules: ToolApprovalRule[],
  prepared: PreparedToolCall,
): BrowserRule | undefined {
  const browserRules = rules.filter((rule): rule is BrowserRule => rule.kind === 'browser')
  if (browserRules.length === 0) {
    return undefined
  }
  return browserRules.find((rule) => {
    if (rule.toolName !== prepared.toolName)
      return false
    if (!rule.urlPattern)
      return true
    const host = extractBrowserHostname(prepared)
    if (!host)
      return false
    return globToRegex(rule.urlPattern).test(host)
  })
}

function extractUrlFromBrowserInput(prepared: PreparedToolCall): string | undefined {
  if (prepared.toolName === 'browser_navigate') {
    const url = prepared.input.url
    if (typeof url === 'string' && url.trim())
      return url.trim()
  }
  return undefined
}

function extractBrowserHostname(prepared: PreparedToolCall): string | undefined {
  const url = extractUrlFromBrowserInput(prepared)
  if (!url)
    return undefined
  try {
    return new URL(url).hostname
  }
  catch {
    return undefined
  }
}

// ---- 候选生成 ----

function createApprovalCandidates(
  prepared: PreparedToolCall,
  workspacePath: string,
  allowedCommandRules: CommandRule[],
): ApprovalGrantCandidates | null {
  if (prepared.scope === 'blocked') {
    return null
  }

  if (isPreparedCommandState(prepared.preparedState)) {
    const command = prepared.preparedState
    if (command.risk !== 'ordinary' || command.hasSecretEnv) {
      return null
    }
    const unmatched = command.segments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) =>
        !segment.isCd
        && !allowedCommandRules.some(rule =>
          rule.interpreter === command.interpreter && matchCommandSegment(segment, rule),
        ),
      )
    const candidates = unmatched.map(({ segment, index }) => ({
      type: 'command-segment' as const,
      interpreter: command.interpreter,
      segmentIndex: index,
      executable: segment.executable,
      displayCommand: [segment.executable, ...segment.args].join(' '),
      argvPrefix: [...segment.args],
      canWholeExecutable: true,
      resourceScope: segment.resourceScope,
    }))
    if (candidates.length === 0) {
      return null
    }
    return { candidates, context: { command } }
  }

  if (FILE_TOOLS.has(prepared.toolName)) {
    const resource = buildFileResource(prepared.toolName, prepared.input, workspacePath)
    if (!resource) {
      return null
    }
    const candidate = createFilesystemCandidate(resource)
    if (!candidate) {
      return null
    }
    return { candidates: [candidate], context: { resource } }
  }

  if (prepared.operationType === 'mcp' && prepared.originalToolName && prepared.serverName) {
    const candidate: ApprovalCandidate = {
      type: 'mcp-tool',
      serverName: prepared.serverName,
      toolName: prepared.originalToolName,
      riskWarning: `授权后，${prepared.serverName} 服务的 ${prepared.originalToolName} 工具可以任意参数调用。`,
    }
    return { candidates: [candidate], context: { serverName: prepared.serverName, toolName: prepared.originalToolName } }
  }

  if (prepared.operationType === 'browser') {
    const url = extractUrlFromBrowserInput(prepared)
    const urlPattern = extractBrowserHostname(prepared)
    const candidate: ApprovalCandidate = {
      type: 'browser',
      toolName: prepared.toolName,
      urlPattern,
      riskWarning: `授权后，${prepared.toolName} 工具可以操作浏览器页面。${urlPattern ? ` 当前限制域名为 ${urlPattern}，可调整。` : ''}`,
    }
    return { candidates: [candidate], context: { toolName: prepared.toolName, url } }
  }

  // 未知工具不生成持久规则候选
  return null
}

// ---- 基础策略 ----

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
  if (operationType === 'read' || operationType === 'command_read' || operationType === 'skill') {
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

// ---- 自动化策略 ----

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
    return { type: 'allow' as const, basis: 'automation.skill.allow' as const }
  }
  if (operationType === 'command_read') {
    return policy.allowCommandExecution
      ? { type: 'allow' as const, basis: 'automation.command-read.allow' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未授权命令执行', basis: 'automation.command-read.blocked' as const }
  }
  if (operationType === 'command') {
    if (!policy.allowCommandExecution)
      return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未授权命令执行', basis: 'automation.command.blocked' as const }
    if (policy.commandPatterns.length === 0)
      return { type: 'allow' as const, basis: 'automation.command.allow' as const }
    const matchKey = String(input.command ?? '')
    return policy.commandPatterns.some(pattern => matchPattern(pattern, matchKey))
      ? { type: 'allow' as const, basis: 'automation.command.pattern-match' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '命令不在自动化任务允许范围内', basis: 'automation.command.pattern-blocked' as const }
  }
  return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: `自动化任务不支持该操作类型: ${operationType}`, basis: 'automation.unsupported' as const }
}

function matchPattern(pattern: string, inputKey: string): boolean {
  return globToRegex(pattern).test(inputKey)
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
