import type { AppRuntime } from '@ant-chat/app-runtime'
import type { AddConversationsSchema, CreateProviderConfigModelSchema, CreateProviderConfigSchema, ImportSkillFromGithubOptions, RunBuiltinCommandParams, SetSkillEnabledOptions, UpdateAgentMemoryInput, UpdateConversationsSchema, UpdateProviderConfigSchema } from '@ant-chat/shared'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { createServer as createHttpServer } from 'node:http'

const MAX_RPC_BODY_BYTES = 32 * 1024 * 1024
const RPC_BODY_TIMEOUT_MS = 30_000

class RpcRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'RpcRequestError'
  }
}

export interface RpcLimits {
  maxBodyBytes?: number
  bodyTimeoutMs?: number
}

export type LocalApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>

export function createLocalServer(runtime: object, limits?: RpcLimits) {
  const handleLocalApiRequest = createLocalApiHandler(runtime, limits)

  return createHttpServer(async (req, res) => {
    const handled = await handleLocalApiRequest(req, res)
    if (handled)
      return

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, msg: `Unknown local API route: ${req.url || '/'}` }))
  })
}

export function createLocalApiHandler(runtime: object, limits?: RpcLimits): LocalApiHandler {
  const appRuntime = runtime as AppRuntime
  const maxBodyBytes = limits?.maxBodyBytes ?? MAX_RPC_BODY_BYTES
  const bodyTimeoutMs = limits?.bodyTimeoutMs ?? RPC_BODY_TIMEOUT_MS

  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      if (!isLocalApiRoute(url))
        return false

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return true
      }

      const body = await readJsonBody(req, maxBodyBytes, bodyTimeoutMs)
      const result = await routeRequest(url, body, appRuntime)

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: true, data: result }))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const statusCode = error instanceof RpcRequestError ? error.statusCode : 500
      res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: false, msg: message }))
    }
    return true
  }
}

function isLocalApiRoute(url: URL): boolean {
  return url.pathname.startsWith('/api/')
}

async function routeRequest(url: URL, body: unknown, runtime: AppRuntime): Promise<unknown> {
  if (url.pathname === '/api/rpc') {
    return dispatchRpc(body, runtime)
  }

  throw new Error(`Unknown local API route: ${url.pathname}`)
}

async function dispatchRpc(body: unknown, runtime: AppRuntime): Promise<unknown> {
  const { method, params } = parseRpcBody(body)

  switch (method) {
    case 'chat.createConversationsTitle':
      return runtime.chat.createConversationTitle(stringParam(params.conversationsId), stringParam(params.modelId))
    case 'chat.getConversations':
      return runtime.chat.listConversations(numberParam(params.pageIndex), numberParam(params.pageSize))
    case 'chat.getWorkspaceConversations':
      return runtime.chat.listConversations(numberParam(params.pageIndex), numberParam(params.pageSize), stringParam(params.workspacePath))
    case 'chat.getConversationById':
      return runtime.chat.getConversation(stringParam(params.id))
    case 'chat.addConversation':
      return runtime.chat.createConversation(params.conversation as AddConversationsSchema)
    case 'chat.updateConversation':
      return runtime.chat.updateConversation(params.conversation as UpdateConversationsSchema)
    case 'chat.deleteConversation':
      return runtime.chat.deleteConversation(stringParam(params.id))
    case 'chat.clearWorkspaceConversations':
      return runtime.chat.clearWorkspaceConversations(stringParam(params.workspacePath))
    case 'chat.getMessagesByConvId':
      return runtime.chat.listMessages(stringParam(params.convId))
    case 'chat.getMessageById':
      return runtime.chat.getMessage(stringParam(params.id))
    case 'chat.addMessage':
      return runtime.chat.createMessage(params.message as never)
    case 'chat.updateMessage':
      return runtime.chat.updateMessage(params.message as never)
    case 'chat.deleteMessage':
      return runtime.chat.deleteMessage(stringParam(params.id))
    case 'chat.batchDeleteMessages':
      return runtime.chat.batchDeleteMessages(Array.isArray(params.ids) ? params.ids.map(String) : [])
    case 'settings.getSettings':
      return runtime.settings.get()
    case 'settings.updateSettings':
      return runtime.settings.update(asRecord(params.updates))
    case 'settings.resetSettings':
      return runtime.settings.reset()
    case 'settings.testProxyConnection':
      return runtime.settings.testProxy(stringParam(params.proxyUrl))
    case 'provider.listProviders':
      return runtime.provider.list()
    case 'provider.createProvider':
      return runtime.provider.create(params.config as CreateProviderConfigSchema)
    case 'provider.updateProvider':
      return runtime.provider.update(params.config as UpdateProviderConfigSchema)
    case 'provider.deleteProvider':
      return runtime.provider.delete(stringParam(params.id))
    case 'provider.getProviderById':
      return runtime.provider.getById(stringParam(params.id))
    case 'provider.getProviderByModelId':
      return runtime.provider.getByModelId(stringParam(params.id))
    case 'provider.getAllAbvailableModels':
      return runtime.provider.listAvailableModels()
    case 'provider.listProviderModels':
      return runtime.provider.listModels(stringParam(params.id))
    case 'provider.setModelEnabledStatus':
      return runtime.provider.setModelEnabled(stringParam(params.id), booleanParam(params.status))
    case 'provider.createProviderModel':
      return runtime.provider.createModel(params.config as CreateProviderConfigModelSchema)
    case 'provider.deleteProviderModel':
      return runtime.provider.deleteModel(stringParam(params.id))
    case 'provider.getModelById':
      return runtime.provider.getModel(stringParam(params.id))
    case 'provider.getModelsDevProviders':
      return runtime.provider.getModelsDevProviders()
    case 'provider.getModelsDevModelsByProviderId':
      return runtime.provider.getModelsDevModels(stringParam(params.providerId))
    case 'provider.importModelsDevModels':
      return runtime.provider.importModelsDevModels(stringParam(params.providerId))
    case 'skills.listSkills':
      return runtime.skills.list()
    case 'skills.importSkillFromZip':
      return runtime.skills.importZip(stringParam(params.filePath))
    case 'skills.importSkillFromGithub':
      return runtime.skills.importGithub(params.options as ImportSkillFromGithubOptions)
    case 'skills.setSkillEnabled':
      return runtime.skills.setEnabled(params.options as SetSkillEnabledOptions)
    case 'skills.deleteSkill':
      return runtime.skills.delete(stringParam(params.name))
    case 'skills.rebuildSkillIndex':
      return runtime.skills.rebuildIndex()
    case 'memory.getMemoryFiles':
      return runtime.memory.getFiles()
    case 'memory.updateMemoryFiles':
      return runtime.memory.updateFiles(params.input as UpdateAgentMemoryInput)
    case 'memory.rollbackSoul':
      return runtime.memory.rollbackSoul()
    case 'mcp.getConfigs':
      return runtime.mcp.getConfigs()
    case 'mcp.getConfigByServerName':
      return runtime.mcp.getConfig(stringParam(params.serverName))
    case 'mcp.addConfig':
      return runtime.mcp.addConfig(params.config as never)
    case 'mcp.updateConfig':
      return runtime.mcp.updateConfig(params.config as never)
    case 'mcp.deleteConfig':
      return runtime.mcp.deleteConfig(stringParam(params.serverName))
    case 'mcp.getConnections':
      return runtime.mcp.getConnections()
    case 'mcp.getAllAvailableToolsList':
      return runtime.mcp.getAllTools()
    case 'mcp.callTool':
      return runtime.mcp.callTool(
        stringParam(params.serverName),
        stringParam(params.toolName),
        params.toolArguments === undefined ? undefined : asRecord(params.toolArguments),
      )
    case 'mcp.connectMcpServer':
      return runtime.mcp.connect(stringParam(params.name), params.config as never)
    case 'mcp.disconnectMcpServer':
      return runtime.mcp.disconnect(stringParam(params.name))
    case 'mcp.reconnectMcpServer':
      return runtime.mcp.reconnect(stringParam(params.name), params.config as never)
    case 'mcp.fetchMcpServerTools':
      return runtime.mcp.fetchTools(stringParam(params.name))
    case 'search.searchByKeyword':
      return runtime.search.messages(stringParam(params.query))
    case 'workspace.listWorkspaces':
      return runtime.workspace.list()
    case 'workspace.addWorkspace':
      return runtime.workspace.add(stringParam(params.path))
    case 'workspace.removeWorkspace':
      return runtime.workspace.remove(stringParam(params.path))
    case 'workspace.openWorkspace':
      return runtime.workspace.open(stringParam(params.path))
    case 'workspace.getCurrentWorkspacePath':
      return runtime.workspace.getCurrentPath()
    case 'workspace.getDefaultWorkspacePath':
      return runtime.workspace.getDefaultPath()
    case 'workspace.listDirectories':
      return runtime.workspace.listDirectories(optionalStringParam(params.path))
    case 'workspace.createDirectory':
      return runtime.workspace.createDirectory(stringParam(params.parentPath), stringParam(params.name))
    case 'workspace.searchWorkspaceFiles':
      return runtime.workspace.searchFiles(
        typeof params.query === 'string' ? params.query : '',
        numberParam(params.limit),
      )
    case 'agent.startTurn':
      return runtime.agent.startTurn(params.options as never)
    case 'agent.approvePendingAction':
      return runtime.agent.approvePendingAction(params.options as never)
    case 'agent.rejectPendingAction':
      return runtime.agent.rejectPendingAction(params.options as never)
    case 'agent.approvePendingActionWithWhitelist':
      return runtime.agent.approvePendingActionWithWhitelist(params.options as never)
    case 'agent.resolveSecretRequest':
      return runtime.agent.resolveSecretRequest(params.options as never)
    case 'agent.rejectSecretRequest':
      return runtime.agent.rejectSecretRequest(params.options as never)
    case 'agent.cancelTask':
      return runtime.agent.cancelTask({ taskId: stringParam(params.taskId) })
    case 'agent.injectSteering':
      return runtime.agent.injectSteering(params as { conversationId: string, text: string })
    case 'agent.listActiveTasks':
      return runtime.agent.listActiveTasks(optionalStringParam(params.conversationId))
    case 'commands.runBuiltinCommand':
      return runtime.commands.run(params as unknown as RunBuiltinCommandParams)
    case 'commands.cancelCommand':
      return runtime.commands.cancel(stringParam(params.conversationId))
    default:
      throw new Error(`Unknown local RPC method: ${method}`)
  }
}

function parseRpcBody(body: unknown): { method: string, params: Record<string, unknown> } {
  const data = asRecord(body, 'RPC body')
  const method = stringParam(data.method)
  const params = data.params === undefined
    ? {}
    : asRecord(data.params, 'RPC params')
  return { method, params }
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

async function readJsonBody(
  req: IncomingMessage,
  maxBytes = MAX_RPC_BODY_BYTES,
  timeoutMs = RPC_BODY_TIMEOUT_MS,
): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RpcRequestError('请求体读取超时', 408))
    }, timeoutMs)
  })

  try {
    const readPromise = (async () => {
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        totalBytes += buf.length
        if (totalBytes > maxBytes) {
          throw new RpcRequestError('请求体超过大小限制', 413)
        }
        chunks.push(buf)
      }
    })()

    await Promise.race([readPromise, timeoutPromise])
  }
  finally {
    if (timer) {
      clearTimeout(timer)
    }
  }

  if (chunks.length === 0) {
    return undefined
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
