import type { ImportModelsDevModelsResult, ModelsDevModel, ModelsDevProvider } from '@ant-chat/agent-runtime'
import type { ConversationRepository, MessageRepository, ProviderSettingsRepository, SettingsRepository, WorkspaceService } from '@ant-chat/app-data'
import type { AddConversationsSchema, AddMessage, AddServiceProviderModelSchema, AddServiceProviderSchema, AgentProfileFiles, ImportSkillFromGithubOptions, SetSkillEnabledOptions, SkillIndex, SkillManifest, UpdateAgentProfileInput, UpdateConversationsSchema, UpdateMessageSchema, UpdateServiceProviderSchema } from '@ant-chat/shared'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { createServer as createHttpServer } from 'node:http'
import { searchWorkspaceFiles } from '@ant-chat/app-data'

export interface LocalServerServices {
  conversationService: ConversationRepository
  messageService: MessageRepository
  settingsService: SettingsRepository
  profileService?: {
    readProfile: () => Promise<AgentProfileFiles>
    updateProfile: (input: UpdateAgentProfileInput) => Promise<AgentProfileFiles>
    rollbackSoul: () => Promise<AgentProfileFiles>
  }
  workspaceService?: Pick<WorkspaceService, 'listWorkspaces' | 'addWorkspace' | 'removeWorkspace' | 'openWorkspace' | 'getCurrentWorkspacePath' | 'getDefaultWorkspacePath'>
  providerSettingsRepository?: ProviderSettingsRepository
  modelsDevImporter?: {
    getModelsDevProviders: () => Promise<ModelsDevProvider[]>
    getModelsDevModelsByProviderId: (providerId: string) => Promise<ModelsDevModel[]>
    importModelsDevModels: (providerId: string) => Promise<ImportModelsDevModelsResult>
  }
  skillService?: {
    listSkills: () => Promise<SkillIndex>
    importFromGithub: (options: ImportSkillFromGithubOptions) => Promise<SkillManifest>
    setEnabled: (name: string, enabled: boolean) => Promise<SkillManifest>
    deleteSkill: (name: string) => Promise<void>
    rebuildIndex: () => Promise<SkillManifest[]>
    getSkillsRoot: () => string
  }
  agentService?: {
    startTurn?: (options: unknown) => Promise<unknown> | unknown
    approvePendingAction?: (options: unknown) => Promise<null> | null
    rejectPendingAction?: (options: unknown) => Promise<null> | null
    cancelTask?: (taskId: string) => Promise<null> | null
    injectSteering?: (params: { conversationId: string, text: string }) => Promise<null>
    listActiveTasks: (conversationId?: string) => Promise<unknown[]> | unknown[]
    approvePendingActionWithWhitelist?: (options: unknown) => Promise<null> | null
  }
}

export type LocalApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>

export function createLocalServer(services: LocalServerServices) {
  const handleLocalApiRequest = createLocalApiHandler(services)

  return createHttpServer(async (req, res) => {
    const handled = await handleLocalApiRequest(req, res)
    if (handled)
      return

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, msg: `Unknown local API route: ${req.url || '/'}` }))
  })
}

export function createLocalApiHandler(services: LocalServerServices): LocalApiHandler {
  return async (req, res) => {
    try {
      writeCorsHeaders(res)

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return true
      }

      const url = new URL(req.url || '/', 'http://localhost')
      if (!isLocalApiRoute(url)) {
        return false
      }

      const body = await readJsonBody(req)
      const result = await routeRequest(url, body, services)

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: true, data: result }))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeCorsHeaders(res)
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: false, msg: message }))
    }
    return true
  }
}

function writeCorsHeaders(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', 'http://127.0.0.1:5173')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
}

function isLocalApiRoute(url: URL): boolean {
  return url.pathname.startsWith('/api/')
}

async function routeRequest(url: URL, body: unknown, services: LocalServerServices): Promise<unknown> {
  if (url.pathname === '/api/rpc') {
    return dispatchRpc(body, services)
  }

  throw new Error(`Unknown local API route: ${url.pathname}`)
}

async function dispatchRpc(body: unknown, services: LocalServerServices): Promise<unknown> {
  const { method, params } = parseRpcBody(body)

  switch (method) {
    case 'chat.createConversationsTitle':
      throw new Error('Conversation title generation is not available in local web transport yet')
    case 'chat.getConversations':
      return services.conversationService.list(numberParam(params.pageIndex), numberParam(params.pageSize))
    case 'chat.getWorkspaceConversations':
      return services.conversationService.list(numberParam(params.pageIndex), numberParam(params.pageSize), stringParam(params.workspacePath))
    case 'chat.getConversationById':
      return services.conversationService.getById(stringParam(params.id))
    case 'chat.addConversation':
      return services.conversationService.create(params.conversation as AddConversationsSchema)
    case 'chat.updateConversation':
      return services.conversationService.update(params.conversation as UpdateConversationsSchema)
    case 'chat.deleteConversation':
      await services.conversationService.delete(stringParam(params.id))
      return null
    case 'chat.getMessagesByConvId':
      return services.messageService.listByConversation(stringParam(params.convId))
    case 'chat.getMessageById':
      return services.messageService.getById(stringParam(params.id))
    case 'chat.addMessage':
      return services.messageService.create(params.message as AddMessage)
    case 'chat.updateMessage':
      return services.messageService.update(params.message as UpdateMessageSchema)
    case 'chat.deleteMessage':
      await services.messageService.delete(stringParam(params.id))
      return null
    case 'chat.getMessagesByConvIdWithPagination':
      return services.messageService.listByConversationPaginated(stringParam(params.id), numberParam(params.pageIndex), numberParam(params.pageSize))
    case 'chat.batchDeleteMessages':
      await services.messageService.batchDelete(Array.isArray(params.ids) ? params.ids.map(String) : [])
      return null
    case 'settings.getSettings':
      return services.settingsService.getGeneralSettings()
    case 'settings.updateSettings':
      return services.settingsService.updateGeneralSettings(asRecord(params.updates))
    case 'settings.resetSettings':
      return services.settingsService.resetGeneralSettings()
    case 'provider.getAllProviderServices':
      return requireProviderRepository(services).getAllProviderServices()
    case 'provider.addProviderServices':
      return requireProviderRepository(services).addProviderService(params.config as AddServiceProviderSchema)
    case 'provider.updateProviderService':
      return requireProviderRepository(services).updateProviderService(params.config as UpdateServiceProviderSchema)
    case 'provider.deleteProviderService':
      requireProviderRepository(services).deleteProviderService(stringParam(params.id))
      return null
    case 'provider.getProviderServicesById': {
      const result = requireProviderRepository(services).getProviderServiceById(stringParam(params.id))
      if (!result)
        throw new Error('not found')
      return result
    }
    case 'provider.getProviderServiceByModelId': {
      const result = requireProviderRepository(services).getServiceProviderByModelId(stringParam(params.id))
      if (!result)
        throw new Error('not found')
      return result
    }
    case 'provider.getAllAbvailableModels':
      return requireProviderRepository(services).getAllAvailableModels()
    case 'provider.getModelsByServiceProviderId':
      return requireProviderRepository(services).getModelsByServiceProviderId(stringParam(params.id))
    case 'provider.setModelEnabledStatus':
      return requireProviderRepository(services).setModelEnabledStatus(stringParam(params.id), booleanParam(params.status))
    case 'provider.addProviderServiceModel':
      return requireProviderRepository(services).addServiceProviderModel(params.config as AddServiceProviderModelSchema)
    case 'provider.deleteProviderServiceModel':
      requireProviderRepository(services).deleteServiceProviderModel(stringParam(params.id))
      return null
    case 'provider.getModelById': {
      const result = requireProviderRepository(services).getModelById(stringParam(params.id))
      if (!result)
        throw new Error('not found')
      return result
    }
    case 'provider.getModelsDevProviders':
      return requireModelsDevImporter(services).getModelsDevProviders()
    case 'provider.getModelsDevModelsByProviderId':
      return requireModelsDevImporter(services).getModelsDevModelsByProviderId(stringParam(params.providerId))
    case 'provider.importModelsDevModels':
      return requireModelsDevImporter(services).importModelsDevModels(stringParam(params.providerId))
    case 'skills.listSkills':
      return requireSkillService(services).listSkills()
    case 'skills.importSkillFromZip':
      throw new Error('Skill ZIP import is not available in local web transport')
    case 'skills.importSkillFromGithub':
      return requireSkillService(services).importFromGithub(params.options as ImportSkillFromGithubOptions)
    case 'skills.setSkillEnabled': {
      const options = params.options as SetSkillEnabledOptions
      return requireSkillService(services).setEnabled(options.name, options.enabled)
    }
    case 'skills.deleteSkill':
      await requireSkillService(services).deleteSkill(stringParam(params.name))
      return null
    case 'skills.rebuildSkillIndex': {
      const skillService = requireSkillService(services)
      const skills = await skillService.rebuildIndex()
      return { rootPath: skillService.getSkillsRoot(), skills }
    }
    case 'profile.getProfile':
      return requireProfileService(services).readProfile()
    case 'profile.updateProfile':
      return requireProfileService(services).updateProfile(params.input as UpdateAgentProfileInput)
    case 'profile.rollbackSoul':
      return requireProfileService(services).rollbackSoul()
    case 'workspace.listWorkspaces':
      return requireWorkspaceService(services).listWorkspaces()
    case 'workspace.addWorkspace':
      return requireWorkspaceService(services).addWorkspace(stringParam(params.path))
    case 'workspace.removeWorkspace':
      return requireWorkspaceService(services).removeWorkspace(stringParam(params.path))
    case 'workspace.openWorkspace':
      return requireWorkspaceService(services).openWorkspace(stringParam(params.path))
    case 'workspace.getCurrentWorkspacePath':
      return requireWorkspaceService(services).getCurrentWorkspacePath()
    case 'workspace.getDefaultWorkspacePath':
      return requireWorkspaceService(services).getDefaultWorkspacePath()
    case 'workspace.searchWorkspaceFiles': {
      const workspaceService = requireWorkspaceService(services)
      return searchWorkspaceFiles(
        workspaceService.getCurrentWorkspacePath(),
        typeof params.query === 'string' ? params.query : '',
        numberParam(params.limit),
      )
    }
    case 'agent.startTurn':
      return requireAgentMethod(services, 'startTurn')(params.options)
    case 'agent.approvePendingAction':
      return requireAgentMethod(services, 'approvePendingAction')(params.options)
    case 'agent.rejectPendingAction':
      return requireAgentMethod(services, 'rejectPendingAction')(params.options)
    case 'agent.approvePendingActionWithWhitelist':
      return requireAgentMethod(services, 'approvePendingActionWithWhitelist')(params.options)
    case 'agent.cancelTask':
      return requireCancelTask(services)(stringParam(params.taskId))
    case 'agent.injectSteering': {
      const fn = services.agentService?.injectSteering
      if (!fn)
        throw new Error('Agent method is not available in local web transport: injectSteering')
      return fn(params as { conversationId: string, text: string })
    }
    case 'agent.listActiveTasks':
      return services.agentService?.listActiveTasks(optionalStringParam(params.conversationId)) ?? []
    default:
      throw new Error(`Unknown local RPC method: ${method}`)
  }
}

function requireProfileService(services: LocalServerServices): NonNullable<LocalServerServices['profileService']> {
  if (!services.profileService) {
    throw new Error('Profile service is not available in local web transport')
  }
  return services.profileService
}

function requireProviderRepository(services: LocalServerServices): ProviderSettingsRepository {
  if (!services.providerSettingsRepository) {
    throw new Error('Provider service is not available in local web transport')
  }
  return services.providerSettingsRepository
}

function requireModelsDevImporter(services: LocalServerServices): NonNullable<LocalServerServices['modelsDevImporter']> {
  if (!services.modelsDevImporter) {
    throw new Error('Models dev importer is not available in local web transport')
  }
  return services.modelsDevImporter
}

function requireSkillService(services: LocalServerServices): NonNullable<LocalServerServices['skillService']> {
  if (!services.skillService) {
    throw new Error('Skill service is not available in local web transport')
  }
  return services.skillService
}

function requireWorkspaceService(services: LocalServerServices): Pick<WorkspaceService, 'listWorkspaces' | 'addWorkspace' | 'removeWorkspace' | 'openWorkspace' | 'getCurrentWorkspacePath' | 'getDefaultWorkspacePath'> {
  if (!services.workspaceService) {
    throw new Error('Workspace service is not available in local web transport')
  }
  return services.workspaceService
}

function parseRpcBody(body: unknown): { method: string, params: Record<string, unknown> } {
  const data = asRecord(body, 'RPC body')
  const method = stringParam(data.method)
  const params = data.params === undefined
    ? {}
    : asRecord(data.params, 'RPC params')
  return { method, params }
}

function requireAgentMethod(services: LocalServerServices, method: 'startTurn' | 'approvePendingAction' | 'rejectPendingAction' | 'approvePendingActionWithWhitelist') {
  const handler = services.agentService?.[method]
  if (!handler) {
    throw new Error(`Agent method is not available in local web transport: ${method}`)
  }
  return handler
}

function requireCancelTask(services: LocalServerServices) {
  const handler = services.agentService?.cancelTask
  if (!handler) {
    throw new Error('Agent method is not available in local web transport: cancelTask')
  }
  return handler
}

function asRecord(value: unknown, name = 'object'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid ${name}`)
  }
  return value as Record<string, unknown>
}

function stringParam(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid string parameter')
  }
  return value
}

function optionalStringParam(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  return stringParam(value)
}

function numberParam(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  throw new TypeError('Invalid number parameter')
}

function booleanParam(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError('Invalid boolean parameter')
  }
  return value
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return undefined
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
