import type { PermissionsFile, ToolApprovalRule, ToolApprovalRuleInput } from '@ant-chat/shared'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { PERMISSIONS_SCHEMA_VERSION, PermissionsFileSchema, ToolApprovalRuleInputSchema, ToolApprovalRuleSchema } from '@ant-chat/shared'
import { AtomicJsonFileStore } from '../file/atomicJsonFileStore'

export interface PermissionRuleGroups {
  global: ToolApprovalRule[]
  workspaces: Record<string, ToolApprovalRule[]>
}

/** 权限文件无法可信读取；调用方必须拒绝放宽权限并记录失败。 */
export class PermissionsFileStoreReadError extends Error {
  constructor(
    message: string,
    readonly quarantinedPath: string | undefined,
    readonly cause: unknown,
    readonly recoveryCause?: unknown,
  ) {
    super(message)
    this.name = 'PermissionsFileStoreReadError'
  }
}

/**
 * 权限规则的独立持久化存储。
 *
 * 文件缺失表示用户尚未创建规则；损坏则隔离证据并抛错，不能与空权限混为一谈。
 * 所有变更都先校验完整结果，再通过原子替换一次提交。
 */
export class PermissionsFileStore {
  private readonly atomicStore: AtomicJsonFileStore<PermissionsFile>

  constructor(private readonly filePath: string) {
    this.atomicStore = new AtomicJsonFileStore(filePath)
  }

  exists(): boolean {
    return this.atomicStore.exists()
  }

  read(): PermissionRuleGroups {
    if (!this.atomicStore.exists())
      return emptyRuleGroups()

    let raw: unknown
    try {
      raw = this.atomicStore.read()
    }
    catch (cause) {
      throw this.quarantineAndRecover('权限文件不是有效 JSON', cause)
    }

    const migrated = migratePermissionsFile(raw)
    const parsed = PermissionsFileSchema.safeParse(migrated)
    if (!parsed.success)
      throw this.quarantineAndRecover(`权限文件 schema 校验失败：${parsed.error.message}`, parsed.error)
    return parsed.data.data
  }

  write(data: PermissionRuleGroups): void {
    const file = PermissionsFileSchema.parse({
      schemaVersion: PERMISSIONS_SCHEMA_VERSION,
      data,
    })
    this.atomicStore.write(file)
  }

  getEffectiveRules(workspacePath: string): { global: ToolApprovalRule[], workspace: ToolApprovalRule[] } {
    const data = this.read()
    return {
      global: data.global,
      workspace: data.workspaces[workspacePath] ?? [],
    }
  }

  /** 一次审批产生的多条规则必须全部通过校验后一次落盘。 */
  saveRules(scope: 'workspace' | 'global', workspacePath: string, rules: ToolApprovalRule[]): void {
    const validatedRules = rules.map(rule => ToolApprovalRuleSchema.parse(rule))
    const data = this.read()
    if (scope === 'global') {
      const ids = new Set(validatedRules.map(rule => rule.id))
      data.global = [...data.global.filter(rule => !ids.has(rule.id)), ...validatedRules]
    }
    else {
      if (!workspacePath)
        throw new Error('workspace scope 需要 workspacePath')
      const ids = new Set(validatedRules.map(rule => rule.id))
      data.workspaces[workspacePath] = [
        ...(data.workspaces[workspacePath] ?? []).filter(rule => !ids.has(rule.id)),
        ...validatedRules,
      ]
    }
    this.write(data)
  }

  addRule(
    scope: 'workspace' | 'global',
    workspacePath: string | undefined,
    rule: ToolApprovalRuleInput,
  ): ToolApprovalRule {
    const input = ToolApprovalRuleInputSchema.parse(rule)
    const now = Date.now()
    const stamped = ToolApprovalRuleSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    })
    const data = this.read()
    this.getScopeRules(data, scope, workspacePath).push(stamped)
    this.write(data)
    return stamped
  }

  updateRule(
    ruleId: string,
    scope: 'workspace' | 'global',
    workspacePath: string | undefined,
    rule: ToolApprovalRuleInput,
  ): ToolApprovalRule {
    const input = ToolApprovalRuleInputSchema.parse(rule)
    const data = this.read()
    const rules = this.getScopeRules(data, scope, workspacePath)
    const index = rules.findIndex(existing => existing.id === ruleId)
    if (index < 0)
      throw new Error(`权限规则不存在：${ruleId}`)

    const existing = rules[index]
    const updated = ToolApprovalRuleSchema.parse({
      ...input,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    })
    rules[index] = updated
    this.write(data)
    return updated
  }

  deleteRule(ruleId: string, scope: 'workspace' | 'global', workspacePath: string | undefined): void {
    const data = this.read()
    const rules = this.getScopeRules(data, scope, workspacePath)
    const index = rules.findIndex(rule => rule.id === ruleId)
    if (index < 0)
      throw new Error(`权限规则不存在：${ruleId}`)

    rules.splice(index, 1)
    if (scope === 'workspace' && rules.length === 0)
      delete data.workspaces[workspacePath!]
    this.write(data)
  }

  clearScope(scope: 'workspace' | 'global', workspacePath: string | undefined): void {
    const data = this.read()
    if (scope === 'global') {
      data.global = []
    }
    else {
      if (!workspacePath)
        throw new Error('workspace scope 需要 workspacePath')
      delete data.workspaces[workspacePath]
    }
    this.write(data)
  }

  clearWorkspace(workspacePath: string): void {
    const data = this.read()
    delete data.workspaces[workspacePath]
    this.write(data)
  }

  countMcpServerRules(serverName: string): number {
    const data = this.read()
    return collectRules(data).filter(rule => rule.kind === 'mcp-tool' && rule.serverName === serverName).length
  }

  deleteMcpServerRules(serverName: string): number {
    const data = this.read()
    let removed = 0
    const remove = (rules: ToolApprovalRule[]) => rules.filter((rule) => {
      const matched = rule.kind === 'mcp-tool' && rule.serverName === serverName
      if (matched)
        removed += 1
      return !matched
    })

    data.global = remove(data.global)
    for (const [workspacePath, rules] of Object.entries(data.workspaces)) {
      const remaining = remove(rules)
      if (remaining.length > 0)
        data.workspaces[workspacePath] = remaining
      else
        delete data.workspaces[workspacePath]
    }
    if (removed > 0)
      this.write(data)
    return removed
  }

  migrateMcpServerName(oldServerName: string, newServerName: string): number {
    const data = this.read()
    const updatedAt = Date.now()
    let migrated = 0
    const migrate = (rules: ToolApprovalRule[]): ToolApprovalRule[] => rules.map((rule) => {
      if (rule.kind !== 'mcp-tool' || rule.serverName !== oldServerName)
        return rule
      migrated += 1
      return ToolApprovalRuleSchema.parse({ ...rule, serverName: newServerName, updatedAt })
    })

    data.global = migrate(data.global)
    for (const [workspacePath, rules] of Object.entries(data.workspaces))
      data.workspaces[workspacePath] = migrate(rules)
    if (migrated > 0)
      this.write(data)
    return migrated
  }

  hasWorkspaceGroup(workspacePath: string): boolean {
    return workspacePath in this.read().workspaces
  }

  listAll(): PermissionRuleGroups {
    return this.read()
  }

  private getScopeRules(
    data: PermissionRuleGroups,
    scope: 'workspace' | 'global',
    workspacePath: string | undefined,
  ): ToolApprovalRule[] {
    if (scope === 'global')
      return data.global
    if (!workspacePath)
      throw new Error('workspace scope 需要 workspacePath')
    return data.workspaces[workspacePath] ??= []
  }

  /** 保留损坏证据后立即恢复一份可写的合法空文件，避免持久化状态变成隐式缺失。 */
  private quarantineAndRecover(message: string, cause: unknown): PermissionsFileStoreReadError {
    let quarantinedPath: string | undefined
    try {
      if (fs.existsSync(this.filePath)) {
        quarantinedPath = `${this.filePath}.corrupted-${Date.now()}-${randomUUID()}`
        fs.renameSync(this.filePath, quarantinedPath)
      }
      this.write(emptyRuleGroups())
    }
    catch (recoveryCause) {
      return new PermissionsFileStoreReadError(
        `${message}；权限文件恢复失败`,
        quarantinedPath,
        cause,
        recoveryCause,
      )
    }
    return new PermissionsFileStoreReadError(message, quarantinedPath, cause)
  }
}

function emptyRuleGroups(): PermissionRuleGroups {
  return { global: [], workspaces: {} }
}

function collectRules(data: PermissionRuleGroups): ToolApprovalRule[] {
  return [...data.global, ...Object.values(data.workspaces).flat()]
}

/**
 * 读路径迁移：将旧版权限文件转换为当前 schema 可接受的格式。
 *
 * 9435b68a 引入时命令规则 kind 为 'bash-command'（无 interpreter 字段），
 * 后续重构为 kind='command' + interpreter。旧规则一律视为 bash 解释器。
 */
function migratePermissionsFile(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null)
    return raw
  const file = raw as Record<string, unknown>
  const data = file.data
  if (typeof data !== 'object' || data === null)
    return raw

  const migrated = { ...file, data: { ...data as Record<string, unknown> } }
  const d = migrated.data as Record<string, unknown>

  if (Array.isArray(d.global))
    d.global = d.global.map(migrateRule)
  if (typeof d.workspaces === 'object' && d.workspaces !== null) {
    const workspaces: Record<string, unknown> = {}
    for (const [key, rules] of Object.entries(d.workspaces as Record<string, unknown>)) {
      workspaces[key] = Array.isArray(rules) ? rules.map(migrateRule) : rules
    }
    d.workspaces = workspaces
  }
  return migrated
}

function migrateRule(rule: unknown): unknown {
  if (typeof rule !== 'object' || rule === null)
    return rule
  const r = rule as Record<string, unknown>
  if (r.kind === 'bash-command') {
    return { ...r, kind: 'command', interpreter: r.interpreter ?? 'bash' }
  }
  return rule
}
