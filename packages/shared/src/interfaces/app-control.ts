// AppControl 契约 — 应用控制面的命令、运行时校验和结果类型。
//
// CLI 只负责 argv 解析；LocalControlServer 必须用这里的 schema 校验 JSON
// 输入，避免把 TypeScript 的编译期联合误当成控制端点的访问校验。

import type { ProviderConfigSchema } from '../schemas/providerConfig'
import type { AutomationDefinition, AutomationRun } from './automation'
import type { ChannelAccountView } from './channels'
import type { GeneralSettingsState } from './generalSettings'
import type { McpConnection } from './mcp'
import { z } from 'zod'
import { AutomationScheduleSchema } from '../schemas/automation'
import { ProviderIntegrationIdSchema } from '../schemas/providerConfig'

const NonEmptyStringSchema = z.string().trim().min(1)
const ProviderApiModeSchema = z.enum(['openai', 'anthropic', 'google', 'deepseek'])
const OptionalRecordOfStringsSchema = z.record(z.string(), z.string()).optional()

const AutomationPermissionPolicyCommandSchema = z.object({
  workspaceAccess: z.enum(['read', 'write']).optional(),
  allowSelectedSkillRuntime: z.boolean().optional(),
  allowBrowser: z.boolean().optional(),
  /** @deprecated use allowSelectedSkillRuntime */
  allowSkillScripts: z.boolean().optional(),
  allowMcpTools: z.boolean().optional(),
  extraFileRoots: z.array(z.string()).optional(),
  allowCommandExecution: z.boolean().optional(),
  commandPatterns: z.array(z.string()).optional(),
}).strict()

const SettingsShowCommandSchema = z.object({ type: z.literal('settings'), action: z.literal('show') })
const SettingsThemeSetCommandSchema = z.object({
  type: z.literal('settings'),
  action: z.literal('theme:set'),
  mode: z.enum(['system', 'light', 'dark']).optional(),
  lightThemeId: NonEmptyStringSchema.optional(),
  darkThemeId: NonEmptyStringSchema.optional(),
}).refine(command => command.mode || command.lightThemeId || command.darkThemeId, {
  error: 'theme:set 至少需要 mode、lightThemeId 或 darkThemeId',
})
const SettingsAssistantSetCommandSchema = z.object({
  type: z.literal('settings'),
  action: z.literal('assistant:set'),
  providerId: NonEmptyStringSchema,
  modelId: NonEmptyStringSchema,
})
const SettingsProxySetCommandSchema = z.object({
  type: z.literal('settings'),
  action: z.literal('proxy:set'),
  mode: z.enum(['none', 'system', 'manual']),
  url: z.string().url().optional(),
})
const SettingsProxyTestCommandSchema = z.object({
  type: z.literal('settings'),
  action: z.literal('proxy:test'),
  url: z.string().url().optional(),
})

const ProviderListCommandSchema = z.object({ type: z.literal('provider'), action: z.literal('list') })
const ProviderGetCommandSchema = z.object({ type: z.literal('provider'), action: z.literal('get'), id: NonEmptyStringSchema })
const ProviderCreateCommandSchema = z.object({
  type: z.literal('provider'),
  action: z.literal('create'),
  name: NonEmptyStringSchema,
  baseUrl: z.string().url(),
  apiMode: ProviderApiModeSchema,
  integrationId: ProviderIntegrationIdSchema,
  apiKey: z.string().optional(),
  isOfficial: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
})
const ProviderUpdateCommandSchema = z.object({
  type: z.literal('provider'),
  action: z.literal('update'),
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema.optional(),
  baseUrl: z.string().url().optional(),
  apiMode: ProviderApiModeSchema.optional(),
  integrationId: ProviderIntegrationIdSchema.optional(),
  apiKey: z.string().optional(),
  isOfficial: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
})
const ProviderDeleteCommandSchema = z.object({ type: z.literal('provider'), action: z.literal('delete'), id: NonEmptyStringSchema })
const ProviderEnableCommandSchema = z.object({ type: z.literal('provider'), action: z.literal('enable'), id: NonEmptyStringSchema })
const ProviderDisableCommandSchema = z.object({ type: z.literal('provider'), action: z.literal('disable'), id: NonEmptyStringSchema })
const ProviderModelsCommandSchema = z.object({ type: z.literal('provider'), action: z.literal('models'), id: NonEmptyStringSchema })
const ProviderKeySetCommandSchema = z.object({
  type: z.literal('provider'),
  action: z.literal('key:set'),
  id: NonEmptyStringSchema,
  apiKey: NonEmptyStringSchema,
})
const ProviderKeyClearCommandSchema = z.object({ type: z.literal('provider'), action: z.literal('key:clear'), id: NonEmptyStringSchema })

const McpListCommandSchema = z.object({ type: z.literal('mcp'), action: z.literal('list') })
const McpGetCommandSchema = z.object({ type: z.literal('mcp'), action: z.literal('get'), name: NonEmptyStringSchema })
const McpInstallStdioCommandSchema = z.object({
  type: z.literal('mcp'),
  action: z.literal('install'),
  serverName: NonEmptyStringSchema,
  transportType: z.literal('stdio'),
  command: NonEmptyStringSchema,
  args: z.array(z.string()).optional(),
  env: OptionalRecordOfStringsSchema,
  description: z.string().optional(),
  timeout: z.number().positive().optional(),
})
const McpInstallStreamableHttpCommandSchema = z.object({
  type: z.literal('mcp'),
  action: z.literal('install'),
  serverName: NonEmptyStringSchema,
  transportType: z.literal('streamable-http'),
  url: z.string().url(),
  headers: OptionalRecordOfStringsSchema,
  description: z.string().optional(),
  timeout: z.number().positive().optional(),
})
const McpEditCommandSchema = z.object({
  type: z.literal('mcp'),
  action: z.literal('edit'),
  serverName: NonEmptyStringSchema,
  transportType: z.enum(['stdio', 'streamable-http']).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: OptionalRecordOfStringsSchema,
  url: z.string().url().optional(),
  headers: OptionalRecordOfStringsSchema,
  description: z.string().nullable().optional(),
  timeout: z.number().positive().optional(),
})
const McpDeleteCommandSchema = z.object({ type: z.literal('mcp'), action: z.literal('delete'), name: NonEmptyStringSchema })
const McpStartCommandSchema = z.object({ type: z.literal('mcp'), action: z.literal('start'), name: NonEmptyStringSchema })
const McpStopCommandSchema = z.object({ type: z.literal('mcp'), action: z.literal('stop'), name: NonEmptyStringSchema })

const AutomationListCommandSchema = z.object({ type: z.literal('automation'), action: z.literal('list') })
const AutomationGetCommandSchema = z.object({ type: z.literal('automation'), action: z.literal('get'), id: NonEmptyStringSchema })
const AutomationRunsCommandSchema = z.object({ type: z.literal('automation'), action: z.literal('runs'), id: NonEmptyStringSchema.optional() })
const AutomationCreateCommandSchema = z.object({
  type: z.literal('automation'),
  action: z.literal('create'),
  name: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema,
  workspacePath: NonEmptyStringSchema,
  providerId: NonEmptyStringSchema,
  modelId: NonEmptyStringSchema,
  schedule: AutomationScheduleSchema,
  allowedSkills: z.array(z.string()).optional(),
  allowedMcpServers: z.array(z.string()).optional(),
  permissionPolicy: AutomationPermissionPolicyCommandSchema.optional(),
  enabled: z.boolean().optional(),
})
const AutomationDeleteCommandSchema = z.object({
  type: z.literal('automation'),
  action: z.literal('delete'),
  id: NonEmptyStringSchema,
  force: z.boolean().optional(),
})

const ChannelListCommandSchema = z.object({ type: z.literal('channel'), action: z.literal('list') })
const ChannelSetupCommandSchema = z.object({ type: z.literal('channel'), action: z.literal('setup'), channelType: z.enum(['feishu', 'weixin']), displayName: NonEmptyStringSchema, defaultWorkspacePath: NonEmptyStringSchema })
const ChannelDisconnectCommandSchema = z.object({ type: z.literal('channel'), action: z.literal('disconnect'), id: NonEmptyStringSchema })
const ChannelPairingRequestsCommandSchema = z.object({ type: z.literal('channel'), action: z.literal('listPairingRequests'), channelAccountId: NonEmptyStringSchema })
const ChannelRejectPairingCommandSchema = z.object({ type: z.literal('channel'), action: z.literal('rejectPairing'), id: NonEmptyStringSchema })
const ChannelCreateCommandSchema = z.object({ type: z.literal('channel'), action: z.literal('create'), channelType: z.enum(['feishu', 'weixin']), displayName: NonEmptyStringSchema, credential: NonEmptyStringSchema, defaultWorkspacePath: NonEmptyStringSchema })
const ChannelDeleteCommandSchema = z.object({ type: z.literal('channel'), action: z.literal('delete'), id: NonEmptyStringSchema })
const ChannelPairingListCommandSchema = z.object({ type: z.literal('channel'), action: z.literal('listPairings'), channelAccountId: NonEmptyStringSchema })
const ChannelPairingUpdateCommandSchema = z.object({ type: z.literal('channel'), action: z.enum(['approvePairing', 'revokePairing']), id: NonEmptyStringSchema })
const ChannelStatusCommandSchema = z.object({ type: z.literal('channel'), action: z.literal('getStatus'), channelType: z.enum(['feishu', 'weixin']) })
const ChannelToggleCommandSchema = z.object({ type: z.literal('channel'), action: z.enum(['enable', 'disable']), id: NonEmptyStringSchema })

export const AppControlCommandSchema = z.union([
  SettingsShowCommandSchema,
  SettingsThemeSetCommandSchema,
  SettingsAssistantSetCommandSchema,
  SettingsProxySetCommandSchema,
  SettingsProxyTestCommandSchema,
  ProviderListCommandSchema,
  ProviderGetCommandSchema,
  ProviderCreateCommandSchema,
  ProviderUpdateCommandSchema,
  ProviderDeleteCommandSchema,
  ProviderEnableCommandSchema,
  ProviderDisableCommandSchema,
  ProviderModelsCommandSchema,
  ProviderKeySetCommandSchema,
  ProviderKeyClearCommandSchema,
  McpListCommandSchema,
  McpGetCommandSchema,
  McpInstallStdioCommandSchema,
  McpInstallStreamableHttpCommandSchema,
  McpEditCommandSchema,
  McpDeleteCommandSchema,
  McpStartCommandSchema,
  McpStopCommandSchema,
  AutomationListCommandSchema,
  AutomationGetCommandSchema,
  AutomationRunsCommandSchema,
  AutomationCreateCommandSchema,
  AutomationDeleteCommandSchema,
  ChannelListCommandSchema,
  ChannelSetupCommandSchema,
  ChannelDisconnectCommandSchema,
  ChannelPairingRequestsCommandSchema,
  ChannelRejectPairingCommandSchema,
  ChannelCreateCommandSchema,
  ChannelDeleteCommandSchema,
  ChannelPairingListCommandSchema,
  ChannelPairingUpdateCommandSchema,
  ChannelStatusCommandSchema,
  ChannelToggleCommandSchema,
])

export type AppControlCommand = z.infer<typeof AppControlCommandSchema>
export type SettingsCommand = Extract<AppControlCommand, { type: 'settings' }>
export type ProviderCommand = Extract<AppControlCommand, { type: 'provider' }>
export type McpCommand = Extract<AppControlCommand, { type: 'mcp' }>
export type AutomationCommand = Extract<AppControlCommand, { type: 'automation' }>
export type ChannelCommand = Extract<AppControlCommand, { type: 'channel' }>

export interface AppControlResultMap {
  'settings:show': { settings: GeneralSettingsState }
  'settings:theme:set': { mode: string }
  'settings:assistant:set': { providerId: string, modelId: string }
  'settings:proxy:set': { mode: string }
  'settings:proxy:test': { ok: boolean }
  'provider:list': { providers: ProviderListItem[] }
  'provider:get': { provider: ProviderListItem }
  'provider:create': { provider: ProviderListItem }
  'provider:update': { provider: ProviderListItem }
  'provider:delete': { deleted: boolean }
  'provider:enable': { id: string, enabled: boolean }
  'provider:disable': { id: string, enabled: boolean }
  'provider:models': { models: ProviderModelItem[] }
  'provider:key:set': { id: string, hasApiKey: boolean }
  'provider:key:clear': { id: string }
  'mcp:list': { mcpServers: McpConnection[] }
  'mcp:get': { mcpServer: McpConnection }
  'mcp:install': { mcpServer: McpListItem }
  'mcp:edit': { mcpServer: McpListItem }
  'mcp:delete': { deleted: boolean, error?: string }
  'mcp:start': { name: string, status: string, error?: string }
  'mcp:stop': { name: string, status: string, error?: string }
  'automation:list': { automations: AutomationDefinition[] }
  'automation:get': { automation: AutomationDefinition }
  'automation:create': { automation: AutomationDefinition }
  'automation:delete': { deleted: boolean }
  'automation:runs': { runs: AutomationRun[] }
  'channel:list': { channels: ChannelAccountView[] }
  'channel:setup': import('./channels').ChannelSetupResult
  'channel:disconnect': { channel: import('./channels').ChannelAccountView }
  'channel:listPairingRequests': { pairings: import('./channels').ChannelPairing[] }
  'channel:rejectPairing': { pairing: import('./channels').ChannelPairing }
  'channel:create': { channel: ChannelAccountView }
  'channel:delete': { deleted: boolean }
  'channel:listPairings': { pairings: import('./channels').ChannelPairing[] }
  'channel:approvePairing': { pairing: import('./channels').ChannelPairing }
  'channel:revokePairing': { pairing: import('./channels').ChannelPairing }
  'channel:getStatus': { status: string, lastError?: string }
  'channel:enable': { id: string, enabled: boolean, status: string }
  'channel:disable': { id: string, enabled: boolean, status: string }
}

type CommandKey<TCommand extends AppControlCommand> = TCommand extends {
  type: infer TType extends string
  action: infer TAction extends string
}
  ? `${TType}:${TAction}`
  : never

export type AppControlResultFor<TCommand extends AppControlCommand> = AppControlResultMap[CommandKey<TCommand> & keyof AppControlResultMap]
export type AppControlResult = AppControlResultFor<AppControlCommand>

/** Provider 列表和详情中的条目（不含 API Key 或 secret ref）。 */
export interface ProviderListItem {
  id: string
  name: string
  baseUrl: string
  apiMode: ProviderConfigSchema['apiMode']
  integrationId?: ProviderConfigSchema['integrationId']
  hasApiKey: boolean
  isOfficial: boolean
  isEnabled: boolean
  createdAt: number
  updatedAt: number
}

/** MCP 生命周期命令返回的条目（不含原始配置中的凭据）。 */
export interface McpListItem {
  name: string
  config: string
  status: 'connected' | 'connecting' | 'disconnected'
  tools?: Array<{ name: string, description?: string }>
  disabled?: boolean
  error?: string
}

/** ProviderModel 列表条目。 */
export interface ProviderModelItem {
  id: string
  modelId: string
  providerId: string
  displayName?: string
  isEnabled: boolean
}
