import type { ConversationService, MessageService, SettingsService, WorkspaceService } from '@ant-chat/app-data'
import type { AddConversationsSchema, AddMessage, UpdateConversationsSchema, UpdateMessageSchema } from '@ant-chat/shared'
import type { IncomingMessage } from 'node:http'
import { Buffer } from 'node:buffer'
import { createServer as createHttpServer } from 'node:http'
import { searchWorkspaceFiles } from '@ant-chat/app-data'

export interface LocalServerServices {
  conversationService: ConversationService
  messageService: MessageService
  settingsService: SettingsService
  workspaceService?: Pick<WorkspaceService, 'listWorkspaces' | 'addWorkspace' | 'removeWorkspace' | 'openWorkspace' | 'getCurrentWorkspacePath' | 'getDefaultWorkspacePath'>
  agentService?: {
    startTurn?: (options: unknown) => Promise<unknown> | unknown
    approvePendingAction?: (options: unknown) => Promise<null> | null
    rejectPendingAction?: (options: unknown) => Promise<null> | null
    cancelTask?: (taskId: string) => Promise<null> | null
    listActiveTasks: (conversationId?: string) => Promise<unknown[]> | unknown[]
    approvePendingActionWithWhitelist?: (options: unknown) => Promise<null> | null
  }
}

export function createLocalServer(services: LocalServerServices) {
  return createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const body = await readJsonBody(req)
      const result = await routeRequest(url, body, services)

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: true, data: result }))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: false, msg: message }))
    }
  })
}

async function routeRequest(url: URL, body: unknown, services: LocalServerServices): Promise<unknown> {
  if (url.pathname === '/api/rpc') {
    return dispatchRpc(body, services)
  }

  if (url.pathname === '/api/conversations' && url.searchParams.has('workspacePath')) {
    const pageIndex = Number(url.searchParams.get('pageIndex') || 0)
    const pageSize = Number(url.searchParams.get('pageSize') || 20)
    const workspacePath = url.searchParams.get('workspacePath') || undefined
    return services.conversationService.list(pageIndex, pageSize, workspacePath)
  }

  if (url.pathname === '/api/conversations' && url.searchParams.has('id')) {
    return services.conversationService.getById(url.searchParams.get('id') || '')
  }

  if (url.pathname === '/api/messages') {
    const conversationId = url.searchParams.get('conversationId') || ''
    const pageIndex = Number(url.searchParams.get('pageIndex') || 0)
    const pageSize = Number(url.searchParams.get('pageSize') || 20)
    return services.messageService.listByConversationPaginated(conversationId, pageIndex, pageSize)
  }

  if (url.pathname === '/api/settings') {
    return services.settingsService.getGeneralSettings()
  }

  if (url.pathname === '/api/settings/update') {
    return services.settingsService.updateGeneralSettings(asRecord(body))
  }

  if (url.pathname === '/api/settings/reset') {
    return services.settingsService.resetGeneralSettings()
  }

  if (url.pathname === '/api/workspaces') {
    return requireWorkspaceService(services).listWorkspaces()
  }

  if (url.pathname === '/api/workspaces/add') {
    return requireWorkspaceService(services).addWorkspace(stringParam(asRecord(body).path))
  }

  if (url.pathname === '/api/workspaces/remove') {
    return requireWorkspaceService(services).removeWorkspace(stringParam(asRecord(body).path))
  }

  if (url.pathname === '/api/workspaces/open') {
    return requireWorkspaceService(services).openWorkspace(stringParam(asRecord(body).path))
  }

  if (url.pathname === '/api/agent/active-tasks') {
    return services.agentService?.listActiveTasks(url.searchParams.get('conversationId') || undefined) ?? []
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
    case 'agent.listActiveTasks':
      return services.agentService?.listActiveTasks(optionalStringParam(params.conversationId)) ?? []
    default:
      throw new Error(`Unknown local RPC method: ${method}`)
  }
}

function requireWorkspaceService(services: LocalServerServices): Pick<WorkspaceService, 'listWorkspaces' | 'addWorkspace' | 'removeWorkspace' | 'openWorkspace' | 'getCurrentWorkspacePath' | 'getDefaultWorkspacePath'> {
  if (!services.workspaceService) {
    throw new Error('Workspace service is not available in local web transport')
  }
  return services.workspaceService
}

function parseRpcBody(body: unknown): { method: string, params: Record<string, unknown> } {
  const data = asRecord(body)
  const method = stringParam(data.method)
  const params = asRecord(data.params)
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
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
