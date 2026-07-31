import type { RuntimeCore } from './createRuntimeCore'
import type { RegisteredRoute } from './routeRegistry'
import type { RuntimeModule } from './runtimeModule'
import { AppControl } from '../app-control/appControl'
import { createFeishuTransport, FeishuConnector } from '../channels/feishu'
import { AgentModule } from './modules/agent'
import { AutomationModule } from './modules/automation'
import { ChannelModule } from './modules/channel'
import { ChatModule } from './modules/chat'
import { CommandsModule } from './modules/commands'
import { createDataRoutes } from './modules/dataRoutes'
import { McpModule } from './modules/mcp'
import { PermissionsModule } from './modules/permissions'
import { ProviderModule } from './modules/provider'
import { RuntimeStatusModule } from './modules/runtime'
import { SettingsModule } from './modules/settings'
import { SkillsModule } from './modules/skills'
import { WorkspaceModule } from './modules/workspace'

export interface RegisteredRuntimeModules {
  lifecycle: RuntimeModule[]
  routes: object[]
  /** 纯转发的数据访问路由（memory / search / files），声明式绑定到 app-data。 */
  routeBindings: RegisteredRoute[]
  appControl: AppControl
}

export function registerRuntimeModules(core: RuntimeCore): RegisteredRuntimeModules {
  const { data, events, logger, secretStore } = core

  const provider = new ProviderModule(data.providerSettingsRepository, secretStore, events, logger)
  const skills = new SkillsModule(core)
  const mcp = new McpModule(core)
  const agent = new AgentModule(core, {
    aiProviderFactory: provider.aiProviderFactory,
    mcpClientHub: mcp.clientHub,
    skills: skills.service,
  })
  const channel = new ChannelModule(core, agent, [new FeishuConnector(credential => createFeishuTransport(credential, logger), logger)])
  const chat = new ChatModule(
    data.conversationRepository,
    data.messageRepository,
    data.workspaceService,
    agent.conversationLifecycle,
    agent.titleGenerator,
  )
  const settings = new SettingsModule(data.settingsRepository, events)
  const workspace = new WorkspaceModule(data.workspaceService, data.permissionsFileStore, events)
  const permissions = new PermissionsModule(data.permissionsFileStore)
  const runtimeStatus = new RuntimeStatusModule(core)
  const automation = new AutomationModule(data.automationRepository, events, logger, {
    startTurn: agent.turnService.startTurn,
    cancelTask: taskId => agent.runtime.cancelTask({ taskId }),
  })
  const commands = new CommandsModule(core, {
    agentRuntime: agent.runtime,
    aiProviderFactory: provider.aiProviderFactory,
    eventEmitter: agent.eventEmitter,
    conversationLifecycle: agent.conversationLifecycle,
  })

  const appControl = new AppControl({ settings, provider, mcp, automation, channel })

  return {
    routes: [chat, settings, provider, mcp, skills, workspace, permissions, runtimeStatus, agent, automation, commands, channel],
    lifecycle: [workspace, skills, provider, settings, mcp, agent, automation, channel],
    routeBindings: createDataRoutes(core),
    appControl,
  }
}
