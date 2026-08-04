import type { BrowserIdentityStatus, SkillManifest } from '@ant-chat/shared'
import type { RuntimeCore } from './createRuntimeCore'
import type { ChannelAgentDependencies } from './modules/channel'
import type { RegisteredRoute } from './routeRegistry'
import type { RuntimeModule } from './runtimeModule'
import { AppControl } from '../app-control/appControl'
import { createFeishuTransport, FeishuConnector } from '../channels/feishu'
import { AgentModule } from './modules/agent'
import { AutomationModule } from './modules/automation'
import { BrowserProfilesModule } from './modules/browserProfiles'
import { ChannelModule } from './modules/channel'
import { ChatModule } from './modules/chat'
import { CommandsModule } from './modules/commands'
import { createDataRoutes } from './modules/dataRoutes'
import { McpModule } from './modules/mcp'
import { PermissionsModule } from './modules/permissions'
import { ProviderModule } from './modules/provider'
import { createCodexProviderIntegration } from './modules/provider/codexIntegration'
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
  /** 宿主专用能力；不注册为普通 AppRpc，避免扩大 Web 文件访问面。 */
  skills: {
    importSkillFromZip: (filePath: string) => Promise<SkillManifest>
  }
  /** 桌面原生目录选择器使用的宿主专用能力。 */
  browserProfiles: {
    importFromDirectory: (directory: string) => Promise<BrowserIdentityStatus>
  }
}

export function registerRuntimeModules(core: RuntimeCore): RegisteredRuntimeModules {
  const { data, events, logger, secretStore } = core

  const provider = new ProviderModule(
    data.providerSettingsRepository,
    secretStore,
    events,
    logger,
    core.oauthCallbackHost,
    // 厂商 Integration 在此注册；新增订阅只需追加 entry，不改 Provider 通用流程。
    [['codex-subscription', createCodexProviderIntegration(secretStore)]],
  )
  const browserProfiles = new BrowserProfilesModule(core.browserIdentity)
  const skills = new SkillsModule(core)
  const mcp = new McpModule(core)
  const agent = new AgentModule(core, {
    aiProviderFactory: provider.aiProviderFactory,
    mcpClientHub: mcp.clientHub,
    skills: skills.service,
  })
  const listActiveTasks = (conversationId?: string) => agent.listActiveTasks({ conversationId })
  const channelAgent: ChannelAgentDependencies = {
    turnService: agent.turnService,
    updateConversation: input => agent.conversationLifecycle.update(input),
    listActiveTasks,
    cancelTask: options => agent.cancelTask(options),
    approvePendingAction: options => agent.approvePendingAction({ options }),
    rejectPendingAction: options => agent.rejectPendingAction({ options }),
    rejectSecretRequest: options => agent.rejectSecretRequest({ options }),
  }
  const channel = new ChannelModule(core, channelAgent, [new FeishuConnector(credential => createFeishuTransport(credential, logger), logger)])
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
    listActiveTasks,
    aiProviderFactory: provider.aiProviderFactory,
    eventEmitter: agent.eventEmitter,
    conversationLifecycle: agent.conversationLifecycle,
  })

  const appControl = new AppControl({ settings, provider, mcp, automation, channel })

  return {
    routes: [chat, settings, provider, mcp, skills, workspace, permissions, runtimeStatus, browserProfiles, agent, automation, commands, channel],
    lifecycle: [browserProfiles, workspace, skills, provider, settings, mcp, agent, automation, channel],
    routeBindings: createDataRoutes(core),
    appControl,
    skills: {
      importSkillFromZip: filePath => skills.importSkillFromZip(filePath),
    },
    browserProfiles: {
      importFromDirectory: directory => browserProfiles.importFromDirectory(directory),
    },
  }
}
