import type { RuntimeCore } from './createRuntimeCore'
import type { RuntimeModule } from './runtimeModule'
import { AgentModule } from './modules/agent'
import { AutomationModule } from './modules/automation'
import { ChatModule } from './modules/chat'
import { CommandsModule } from './modules/commands'
import { FilesModule } from './modules/files'
import { McpModule } from './modules/mcp'
import { MemoryModule } from './modules/memory'
import { ProviderModule } from './modules/provider'
import { SearchModule } from './modules/search'
import { SettingsModule } from './modules/settings'
import { SkillsModule } from './modules/skills'
import { WorkspaceModule } from './modules/workspace'

export interface RegisteredRuntimeModules {
  lifecycle: RuntimeModule[]
  routes: object[]
}

export function registerRuntimeModules(core: RuntimeCore): RegisteredRuntimeModules {
  const provider = new ProviderModule(core)
  const skills = new SkillsModule(core)
  const mcp = new McpModule(core)
  const agent = new AgentModule(core, {
    aiProviderFactory: provider.aiProviderFactory,
    mcpClientHub: mcp.clientHub,
    skills: skills.service,
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
  const memory = new MemoryModule(core)
  const search = new SearchModule(core)
  const files = new FilesModule(core)

  return {
    routes: [chat, settings, provider, mcp, search, memory, skills, workspace, agent, automation, commands, files],
    lifecycle: [workspace, skills, provider, settings, mcp, agent, automation],
  }
}
