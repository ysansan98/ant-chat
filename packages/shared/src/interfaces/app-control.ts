// AppControl 契约 — 应用控制面的命令/结果类型
// 本类型定义了一组白名单命令，涵盖设置、Provider、MCP、自动化管理。
// 所有敏感值（API Key、Token、密码）在结果中归约/脱敏为 hasSecret 布尔值。
//
// 规则：
// - 查询命令（show/list/get）→ scope=workspace，无需审批
// - 修改命令（set/update/create/enable/disable）→ scope=outside，需审批
// - 删除/关键操作 → scope=outside，需审批
// - CLI 和 Agent 原生工具都使用此联合，不额外复制业务规则。

import type { ProviderConfigSchema } from '../schemas/providerConfig'
import type { AutomationDefinition, AutomationRun } from './automation'
import type { GeneralSettingsState } from './generalSettings'
import type { McpConnection } from './mcp'

// ── 设置命令 ──────────────────────────────────────────

export interface SettingsShowCommand {
  type: 'settings'
  action: 'show'
}

export interface SettingsThemeSetCommand {
  type: 'settings'
  action: 'theme:set'
  mode?: 'system' | 'light' | 'dark'
  lightThemeId?: string
  darkThemeId?: string
}

export interface SettingsAssistantSetCommand {
  type: 'settings'
  action: 'assistant:set'
  providerId: string
  modelId: string
}

export interface SettingsProxySetCommand {
  type: 'settings'
  action: 'proxy:set'
  mode: 'none' | 'system' | 'manual'
  url?: string
}

export interface SettingsProxyTestCommand {
  type: 'settings'
  action: 'proxy:test'
  url?: string
}

// ── Provider 命令 ─────────────────────────────────────

export interface ProviderListCommand {
  type: 'provider'
  action: 'list'
}

export interface ProviderGetCommand {
  type: 'provider'
  action: 'get'
  id: string
}

export interface ProviderCreateCommand {
  type: 'provider'
  action: 'create'
  name: string
  baseUrl: string
  apiMode: 'openai' | 'anthropic' | 'google' | 'deepseek'
  /** 外部 CLI 可提交真实值；Agent 工具必须通过 secretRef 字段输入。 */
  apiKey?: string
  isOfficial?: boolean
  isEnabled?: boolean
}

export interface ProviderUpdateCommand {
  type: 'provider'
  action: 'update'
  id: string
  name?: string
  baseUrl?: string
  apiMode?: 'openai' | 'anthropic' | 'google' | 'deepseek'
  apiKey?: string
  isOfficial?: boolean
  isEnabled?: boolean
}

export interface ProviderDeleteCommand {
  type: 'provider'
  action: 'delete'
  id: string
}

export interface ProviderEnableCommand {
  type: 'provider'
  action: 'enable'
  id: string
}

export interface ProviderDisableCommand {
  type: 'provider'
  action: 'disable'
  id: string
}

export interface ProviderModelsCommand {
  type: 'provider'
  action: 'models'
  id: string
}

export interface ProviderKeySetCommand {
  type: 'provider'
  action: 'key:set'
  id: string
  /** 外部 CLI 使用的真实值；Agent 工具不会向模型暴露此字段。 */
  apiKey?: string
}

export interface ProviderKeyClearCommand {
  type: 'provider'
  action: 'key:clear'
  id: string
}

// ── MCP 命令 ──────────────────────────────────────────

export interface McpListCommand {
  type: 'mcp'
  action: 'list'
}

export interface McpGetCommand {
  type: 'mcp'
  action: 'get'
  name: string
}

export interface McpInstallCommand {
  type: 'mcp'
  action: 'install'
  serverName: string
  transportType: 'stdio' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  icon?: string
  description?: string
  timeout?: number
}

export interface McpEditCommand {
  type: 'mcp'
  action: 'edit'
  serverName: string
  transportType?: 'stdio' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  icon?: string
  description?: string
  timeout?: number
}

export interface McpDeleteCommand {
  type: 'mcp'
  action: 'delete'
  name: string
}

export interface McpStartCommand {
  type: 'mcp'
  action: 'start'
  name: string
}

export interface McpStopCommand {
  type: 'mcp'
  action: 'stop'
  name: string
}

// ── Automation 命令 ────────────────────────────────────

export interface AutomationListCommand {
  type: 'automation'
  action: 'list'
}

export interface AutomationGetCommand {
  type: 'automation'
  action: 'get'
  id: string
}

export interface AutomationRunsCommand {
  type: 'automation'
  action: 'runs'
  id?: string
}

export interface AutomationCreateCommand {
  type: 'automation'
  action: 'create'
  name: string
  prompt: string
  workspacePath: string
  providerId: string
  modelId: string
  schedule: { type: 'once', runAt: number } | { type: 'cron', expression: string, timezone: string }
  selectedSkills?: string[]
  selectedMcpServers?: string[]
  permissionPolicy?: {
    workspaceAccess?: 'read' | 'write'
    allowSkillScripts?: boolean
    allowMcpMutations?: boolean
    extraFileRoots?: string[]
    allowArbitraryCommands?: boolean
    commandPatterns?: string[]
    allowNetwork?: boolean
  }
  enabled?: boolean
}

export interface AutomationDeleteCommand {
  type: 'automation'
  action: 'delete'
  id: string
  force?: boolean
}

// ── 命令判别联合 ──────────────────────────────────────

export type AppControlCommand
  // 设置
  = | SettingsShowCommand
    | SettingsThemeSetCommand
    | SettingsAssistantSetCommand
    | SettingsProxySetCommand
    | SettingsProxyTestCommand
  // Provider
    | ProviderListCommand
    | ProviderGetCommand
    | ProviderCreateCommand
    | ProviderUpdateCommand
    | ProviderDeleteCommand
    | ProviderEnableCommand
    | ProviderDisableCommand
    | ProviderModelsCommand
    | ProviderKeySetCommand
    | ProviderKeyClearCommand
  // MCP
    | McpListCommand
    | McpGetCommand
    | McpInstallCommand
    | McpEditCommand
    | McpDeleteCommand
    | McpStartCommand
    | McpStopCommand
  // Automation
    | AutomationListCommand
    | AutomationGetCommand
    | AutomationRunsCommand
    | AutomationCreateCommand
    | AutomationDeleteCommand

// ── 结果类型 ──────────────────────────────────────────

export type AppControlResult = AppControlResultMap[AppControlCommand['action']]

export interface AppControlResultMap {
  'show': { settings: GeneralSettingsState }
  'theme:set': { mode: string }
  'assistant:set': { providerId: string, modelId: string }
  'proxy:set': { mode: string }
  'proxy:test': { ok: boolean }
  'list':
    | { providers: ProviderListItem[] }
    | { mcpServers: McpConnection[] }
    | { automations: AutomationDefinition[] }
  'get':
    | { provider: ProviderConfigSchema }
    | { mcpServer: McpConnection }
    | { automation: AutomationDefinition }
  'create':
    | { provider: ProviderConfigSchema }
    | { mcpServer: McpListItem }
    | { automation: AutomationDefinition }
  'update': { provider: ProviderConfigSchema }
  'delete': { deleted: boolean }
  'enable': { id: string, enabled: boolean }
  'disable': { id: string, enabled: boolean }
  'models': { models: ProviderModelItem[] }
  'key:set': { id: string, hasApiKey: boolean }
  'key:clear': { id: string }
  'install': { mcpServer: McpListItem }
  'edit': { mcpServer: McpListItem }
  'start': { name: string, status: string }
  'stop': { name: string, status: string }
  'runs': { runs: AutomationRun[] }
}

/** Provider 列表中的条目（无 API Key） */
export interface ProviderListItem {
  id: string
  name: string
  baseUrl: string
  apiMode: string
  hasApiKey: boolean
  isOfficial: boolean
  isEnabled: boolean
  createdAt: number
  updatedAt: number
}

/** MCP 列表中的条目（脱敏后） */
export interface McpListItem {
  name: string
  config: string
  status: 'connected' | 'connecting' | 'disconnected'
  tools?: Array<{ name: string, description?: string }>
  disabled?: boolean
  error?: string
}

/** ProviderModel 列表条目 */
export interface ProviderModelItem {
  id: string
  modelId: string
  providerId: string
  displayName?: string
  isEnabled: boolean
}

// ── 权限辅助 ──────────────────────────────────────────

/** 将 AppControlCommand 映射到操作类型 */
export function getAppControlOperationType(cmd: AppControlCommand): 'read' | 'write' {
  switch (true) {
    case cmd.action === 'show':
    case cmd.action === 'list':
    case cmd.action === 'get':
    case cmd.action === 'models':
    case cmd.action === 'runs':
      return 'read'
    default:
      return 'write'
  }
}

/** 敏感操作 — 需要额外审批 */
export function isSensitiveAppControlCommand(cmd: AppControlCommand): boolean {
  switch (true) {
    case cmd.action === 'delete':
    case cmd.type === 'provider' && cmd.action === 'key:clear':
      return true
    default:
      return false
  }
}

/** 命令的人类可读描述 */
export function describeAppControlCommand(cmd: AppControlCommand): string {
  const parts: string[] = []
  switch (cmd.type) {
    case 'settings':
      parts.push('设置')
      break
    case 'provider':
      parts.push('AI 服务商')
      break
    case 'mcp':
      parts.push('MCP')
      break
    case 'automation':
      parts.push('自动化')
      break
  }
  switch (cmd.action) {
    case 'show':
      parts.push('查看')
      break
    case 'theme:set':
      parts.push('切换主题')
      break
    case 'assistant:set':
      parts.push('修改助理模型')
      break
    case 'proxy:set':
      parts.push('修改网络代理')
      break
    case 'proxy:test':
      parts.push('测试代理连接')
      break
    case 'list':
      parts.push('列表')
      break
    case 'get':
      parts.push('查看详情')
      break
    case 'create':
      parts.push('创建')
      break
    case 'update':
      parts.push('更新')
      break
    case 'delete':
      parts.push('删除')
      break
    case 'enable':
      parts.push('启用')
      break
    case 'disable':
      parts.push('禁用')
      break
    case 'models':
      parts.push('查看模型列表')
      break
    case 'key:set':
      parts.push('配置 API Key')
      break
    case 'key:clear':
      parts.push('清除 API Key')
      break
    case 'install':
      parts.push('安装')
      break
    case 'edit':
      parts.push('编辑')
      break
    case 'start':
      parts.push('启动')
      break
    case 'stop':
      parts.push('停止')
      break
    case 'runs':
      parts.push('查看运行记录')
      break
  }
  if ('id' in cmd && typeof cmd.id === 'string') {
    parts.push(`[${cmd.id}]`)
  }
  if ('name' in cmd && typeof cmd.name === 'string' && !('id' in cmd)) {
    parts.push(`[${cmd.name}]`)
  }
  if ('serverName' in cmd && typeof cmd.serverName === 'string') {
    parts.push(`[${cmd.serverName}]`)
  }
  return parts.join(' ')
}
