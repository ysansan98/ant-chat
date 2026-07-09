import type { RuntimeCore } from './createRuntimeCore'
import type { RegisteredRoute } from './routeRegistry'
import type { RuntimeModule } from './runtimeModule'
import { AppControl } from '../app-control/appControl'
import { AgentModule } from './modules/agent'
import { AutomationModule } from './modules/automation'
import { ChatModule } from './modules/chat'
import { CommandsModule } from './modules/commands'
import { createDataRoutes } from './modules/dataRoutes'
import { McpModule } from './modules/mcp'
import { ProviderModule } from './modules/provider'
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
  const provider = new ProviderModule(core)
  const skills = new SkillsModule(core)
  const mcp = new McpModule(core)
  const agent = new AgentModule(core, {
    aiProviderFactory: provider.aiProviderFactory,
    mcpClientHub: mcp.clientHub,
    skills: skills.service,
    contextDiagnosticsEnabled: core.contextDiagnosticsEnabled,
  })
  const chat = new ChatModule(core, agent.runtime, agent.titleGenerator)
  const settings = new SettingsModule(core)
  const workspace = new WorkspaceModule(core)
  const automation = new AutomationModule(core, {
    agentController: agent.controller,
    agentRuntime: agent.runtime,
  })
  const commands = new CommandsModule(core, {
    agentRuntime: agent.runtime,
    aiProviderFactory: provider.aiProviderFactory,
    eventEmitter: agent.eventEmitter,
  })

  const appControl = new AppControl(
    { settings, provider, mcp, automation },
    core.secretStore,
  )

  return {
    routes: [chat, settings, provider, mcp, skills, workspace, agent, automation, commands],
    lifecycle: [workspace, skills, provider, settings, mcp, agent, automation],
    routeBindings: createDataRoutes(core),
    appControl,
  }
}
