import type { CommandInterpreter } from './command'

import { z } from 'zod'
import { CommandInterpreterSchema } from './command'

/**
 * 权限规则：用户在交互审批或"权限"页面显式保存的结构化授权。
 *
 * 规则只能满足基础策略的 require_approval，不能覆盖系统阻断，
 * 也不参与 Automation。按全局或 canonical 工作区分组，并按命令、文件系统或 MCP 表达可复用边界。
 *
 * 详见 docs/adr/0001-tool-approval-rules.md。
 */

// ---- 规则公共字段 ----

export const RuleBaseSchema = z.object({
  /** 稳定唯一 ID，用于 Trace、管理和原子 mutation */
  id: z.string().min(1),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  /** deny 规则是黑名单，命中后始终阻止；缺失时兼容既有 allow 规则。 */
  effect: z.enum(['allow', 'deny']).optional(),
}).strict()

// ---- 命令规则 ----

export const CommandRuleSchema = RuleBaseSchema.extend({
  kind: z.literal('command'),
  interpreter: CommandInterpreterSchema,
  /** PATH/相对命令保留原文；绝对路径命令保存 canonical 路径 */
  executable: z.string().min(1),
  /** 固定前缀参数（不含可执行文件本身） */
  argvPrefix: z.array(z.string()),
  /** argvPrefix 必须完整匹配；为 true 时，其后还可有零个或任意多个参数 */
  allowRemainingArgs: z.boolean(),
  /** 资源边界：workspace = cwd 和可见路径参数在当前工作区内；outside = 工作区外 */
  resourceScope: z.enum(['workspace', 'outside']),
})

// ---- 文件系统规则 ----

export const FilesystemRuleSchema = RuleBaseSchema.extend({
  kind: z.literal('filesystem'),
  access: z.enum(['read', 'write']),
  targetType: z.enum(['file', 'directory']),
  /** canonical 真实路径；目录规则只能是递归读取 */
  canonicalPath: z.string().min(1),
  recursive: z.boolean(),
})

// ---- MCP 工具规则 ----

export const McpToolRuleSchema = RuleBaseSchema.extend({
  kind: z.literal('mcp-tool'),
  serverName: z.string().min(1),
  toolName: z.string().min(1),
})

// ---- 封闭规则联合 ----

export const ToolApprovalRuleSchema = z.discriminatedUnion('kind', [
  CommandRuleSchema,
  FilesystemRuleSchema,
  McpToolRuleSchema,
]).superRefine((rule, context) => {
  const message = getFilesystemConstraintError(rule)
  if (message) {
    context.addIssue({
      code: 'custom',
      message,
      path: ['recursive'],
    })
  }
})

export type ToolApprovalRule = z.infer<typeof ToolApprovalRuleSchema>
export type CommandRule = z.infer<typeof CommandRuleSchema>
export type FilesystemRule = z.infer<typeof FilesystemRuleSchema>
export type McpToolRule = z.infer<typeof McpToolRuleSchema>

export type RuleKind = ToolApprovalRule['kind']

// ---- 权限管理输入 ----

const CommandRuleInputSchema = CommandRuleSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).strict()

const FilesystemRuleInputSchema = FilesystemRuleSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).strict()

const McpToolRuleInputSchema = McpToolRuleSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).strict()

/** 管理页只能提交规则能力，持久化身份和时间戳由后端生成。 */
export const ToolApprovalRuleInputSchema = z.discriminatedUnion('kind', [
  CommandRuleInputSchema,
  FilesystemRuleInputSchema,
  McpToolRuleInputSchema,
]).superRefine((rule, context) => {
  const message = getFilesystemConstraintError(rule)
  if (message) {
    context.addIssue({
      code: 'custom',
      message,
      path: ['recursive'],
    })
  }
})

export type ToolApprovalRuleInput = z.infer<typeof ToolApprovalRuleInputSchema>

function getFilesystemConstraintError(
  rule: ToolApprovalRule | ToolApprovalRuleInput,
): string | null {
  if (rule.kind !== 'filesystem')
    return null
  if (rule.targetType === 'directory') {
    if (rule.access !== 'read')
      return '目录规则只支持读取'
    if (!rule.recursive)
      return '目录规则必须是递归读取'
  }
  else if (rule.recursive) {
    return '文件规则不支持递归'
  }
  return null
}

// ---- 权限文件 schema ----

export const PermissionsFileSchema = z.object({
  schemaVersion: z.literal(1),
  data: z.object({
    global: z.array(ToolApprovalRuleSchema),
    workspaces: z.record(z.string().min(1), z.array(ToolApprovalRuleSchema)),
  }).strict(),
}).strict()

export type PermissionsFile = z.infer<typeof PermissionsFileSchema>

export const PERMISSIONS_SCHEMA_VERSION = 1

// ---- 审批候选 ----

/**
 * 审批候选：后端在 pending action 中构造、前端展示、用户选择后提交回后端的候选规则。
 * 前端只提交对候选的选择（索引和调整），后端从 pending action 重建最终规则并校验。
 */

export interface CommandSegmentCandidate {
  type: 'command-segment'
  /** 命令实际使用的解释器，持久规则只匹配相同解释器。 */
  interpreter: CommandInterpreter
  /** 该段在命令中的序号 */
  segmentIndex: number
  /** 用户实际看到并授权的命令名或路径 */
  executable: string
  /** 可执行的命令文本（仅展示） */
  displayCommand: string
  /** 建议的 argvPrefix */
  argvPrefix: string[]
  /** 是否可切换为 whole-executable（只有用户主动选择） */
  canWholeExecutable: boolean
  resourceScope: 'workspace' | 'outside'
}

export interface FilesystemCandidate {
  type: 'filesystem'
  access: 'read' | 'write'
  targetType: 'file' | 'directory'
  canonicalPath: string
  displayPath: string
  /** 是否建议递归（目录读取时为 true） */
  suggestRecursive: boolean
  /** 是否可选择父目录递归读取（文件读取时） */
  canParentDirectory: boolean
}

export interface McpToolCandidate {
  type: 'mcp-tool'
  serverName: string
  toolName: string
  /** MCP 任意参数授权的风险提示文案 */
  riskWarning: string
}

export type ApprovalCandidate = CommandSegmentCandidate | FilesystemCandidate | McpToolCandidate

/**
 * 用户对候选的选择：提交候选索引和可能的调整。
 * 前端不提交任意可执行规则，只提交对后端候选项的选择。
 */
export interface ApprovalCandidateSelection {
  /** 候选在 candidates 数组中的索引 */
  candidateIndex: number
  /** 命令: 调整后的 argvPrefix（可选，仅 command-segment 候选） */
  adjustedArgvPrefix?: string[]
  /** 命令: 固定参数之后是否允许零个或任意多个参数 */
  allowRemainingArgs?: boolean
  /** 命令: 是否选择整个可执行文件（需二次确认） */
  wholeExecutable?: boolean
  /** 文件: 是否选择父目录递归读取 */
  parentDirectory?: boolean
}

// ---- 审批输入 ----

/**
 * 用户提交的审批选择。
 * 前端只提交 taskId、actionId 和用户对后端候选项的选择；
 * 后端从 pending action 重建、规范化并验证最终规则。
 */
export interface ApprovalSelectionInput {
  /** 选中的候选（空数组 = 仅本次允许，不持久化） */
  selections: ApprovalCandidateSelection[]
  /** 保存到全局还是当前工作区 */
  scope: 'workspace' | 'global'
}

// ---- 待审批动作扩展 ----

/**
 * pending action 中的候选规则信息。
 * 后端在创建 pending action 时构造，用户审批时从快照重建并校验。
 */
export interface ApprovalGrantCandidates {
  candidates: ApprovalCandidate[]
  /** 后端用于重建规则的原始上下文（序列化后的工具输入快照） */
  context: Record<string, unknown>
}
