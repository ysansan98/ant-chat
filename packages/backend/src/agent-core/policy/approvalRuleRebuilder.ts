import type { ApprovalCandidate, ApprovalGrantCandidates, BashCommandRule, FilesystemRule, McpToolRule, ToolApprovalRule } from '@ant-chat/shared'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

/**
 * 从审批候选和用户选择重建持久规则。
 *
 * 后端从 pending action 重建、规范化并验证最终规则。
 * 前端只提交 taskId、actionId 和用户对后端候选项的选择；
 * 禁止前端提交任意可执行规则。
 *
 * 详见 docs/adr/0001-tool-approval-rules.md §8。
 */
export function rebuildRulesFromApproval(
  grant: ApprovalGrantCandidates,
  selection: {
    selections: Array<{
      candidateIndex: number
      adjustedArgvPrefix?: string[]
      allowRemainingArgs?: boolean
      wholeExecutable?: boolean
      parentDirectory?: boolean
    }>
    scope: 'workspace' | 'global'
  },
): ToolApprovalRule[] {
  const rules: ToolApprovalRule[] = []

  for (const sel of selection.selections) {
    const candidate = grant.candidates[sel.candidateIndex]
    if (!candidate) {
      throw new Error(`审批候选索引无效：${sel.candidateIndex}`)
    }

    const rule = rebuildSingleRule(candidate, sel, grant.context)
    if (rule) {
      rules.push(rule)
    }
  }

  return rules
}

function rebuildSingleRule(
  candidate: ApprovalCandidate,
  selection: {
    adjustedArgvPrefix?: string[]
    allowRemainingArgs?: boolean
    wholeExecutable?: boolean
    parentDirectory?: boolean
  },
  context: Record<string, unknown>,
): ToolApprovalRule | null {
  if (candidate.type === 'bash-segment') {
    return rebuildBashRule(candidate, selection, context)
  }

  if (candidate.type === 'filesystem') {
    return rebuildFilesystemRuleFromCandidate(candidate, selection)
  }

  if (candidate.type === 'mcp-tool') {
    return rebuildMcpRule(candidate)
  }

  return null
}

function rebuildBashRule(
  candidate: Extract<ApprovalCandidate, { type: 'bash-segment' }>,
  selection: {
    adjustedArgvPrefix?: string[]
    allowRemainingArgs?: boolean
    wholeExecutable?: boolean
  },
  context: Record<string, unknown>,
): BashCommandRule | null {
  const parsed = context.parsed as { segments: Array<{ args: string[] }> } | undefined
  if (!parsed) {
    throw new Error('Bash 审批候选缺少解析后的命令上下文')
  }

  const now = Date.now()
  const wholeExecutable = selection.wholeExecutable ?? false
  const argvPrefix = wholeExecutable
    ? []
    : (selection.adjustedArgvPrefix ?? candidate.argvPrefix)
  const allowRemainingArgs = wholeExecutable
    ? true
    : (selection.allowRemainingArgs ?? false)

  if (wholeExecutable && !candidate.canWholeExecutable)
    throw new Error('当前 Bash 候选不允许授权整个可执行文件')
  if (!wholeExecutable && argvPrefix.length === 0 && allowRemainingArgs)
    throw new Error('空参数前缀并允许任意后续参数时，必须显式选择 wholeExecutable')

  // 校验 argvPrefix 必须是实际参数的前缀
  const segment = parsed.segments?.[candidate.segmentIndex]
  if (!segment) {
    throw new Error(`Bash 审批候选引用了无效命令段：${candidate.segmentIndex}`)
  }
  if (!wholeExecutable && !argvPrefix.every((arg, i) => arg === segment.args[i])) {
    throw new Error(`参数前缀与实际命令段不匹配：${candidate.segmentIndex}`)
  }

  return {
    id: randomUUID(),
    effect: 'allow',
    kind: 'bash-command',
    executable: candidate.executable,
    argvPrefix,
    allowRemainingArgs,
    resourceScope: candidate.resourceScope,
    createdAt: now,
    updatedAt: now,
  }
}

function rebuildFilesystemRuleFromCandidate(
  candidate: Extract<ApprovalCandidate, { type: 'filesystem' }>,
  selection: { parentDirectory?: boolean },
): FilesystemRule | null {
  const now = Date.now()

  if (candidate.access === 'write') {
    return {
      id: randomUUID(),
      effect: 'allow',
      kind: 'filesystem',
      access: 'write',
      targetType: 'file',
      canonicalPath: candidate.canonicalPath,
      recursive: false,
      createdAt: now,
      updatedAt: now,
    }
  }

  if (candidate.targetType === 'directory') {
    return {
      id: randomUUID(),
      effect: 'allow',
      kind: 'filesystem',
      access: 'read',
      targetType: 'directory',
      canonicalPath: candidate.canonicalPath,
      recursive: true,
      createdAt: now,
      updatedAt: now,
    }
  }

  // 文件读取
  if (selection.parentDirectory) {
    const parentDir = path.dirname(candidate.canonicalPath)
    return {
      id: randomUUID(),
      effect: 'allow',
      kind: 'filesystem',
      access: 'read',
      targetType: 'directory',
      canonicalPath: parentDir,
      recursive: true,
      createdAt: now,
      updatedAt: now,
    }
  }

  return {
    id: randomUUID(),
    effect: 'allow',
    kind: 'filesystem',
    access: 'read',
    targetType: 'file',
    canonicalPath: candidate.canonicalPath,
    recursive: false,
    createdAt: now,
    updatedAt: now,
  }
}

function rebuildMcpRule(
  candidate: Extract<ApprovalCandidate, { type: 'mcp-tool' }>,
): McpToolRule {
  const now = Date.now()
  return {
    id: randomUUID(),
    effect: 'allow',
    kind: 'mcp-tool',
    serverName: candidate.serverName,
    toolName: candidate.toolName,
    createdAt: now,
    updatedAt: now,
  }
}
