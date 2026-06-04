import type { AppDataContext } from '@ant-chat/app-data'
import type { AgentTaskSnapshot, IAgentEventEmitter, ILogger, RunBuiltinCommandParams, RunBuiltinCommandResult } from '@ant-chat/shared'
import { runCompact } from './compactCommand'
import { runNew } from './conversationCommands'
import { runFork } from './messageFork'

export interface CommandControllerDeps {
  appDataContext: AppDataContext
  eventEmitter: IAgentEventEmitter
  logger?: ILogger
  listActiveTasks: (conversationId?: string) => AgentTaskSnapshot[]
}

export interface CommandController {
  runBuiltinCommand: (params: RunBuiltinCommandParams) => Promise<RunBuiltinCommandResult>
  cancelCommand: (conversationId: string) => void
}

export function createCommandController(deps: CommandControllerDeps): CommandController {
  const { appDataContext, logger, listActiveTasks } = deps
  const abortControllers = new Map<string, AbortController>()

  function log(msg: string) {
    logger?.info(`[command-controller] ${msg}`)
    console.log(`[command-controller] ${msg}`)
  }

  function guardConversationIdle(conversationId: string) {
    const active = listActiveTasks(conversationId)
    if (active.some(t => ['running', 'awaiting_approval'].includes(t.status))) {
      throw new Error('Agent task is running, cannot execute command')
    }
  }

  function cancelCommand(conversationId: string) {
    const ctrl = abortControllers.get(conversationId)
    if (ctrl) {
      log(`cancelling command for ${conversationId}`)
      ctrl.abort()
    }
  }

  return {
    async runBuiltinCommand(params: RunBuiltinCommandParams): Promise<RunBuiltinCommandResult> {
      log(`runBuiltinCommand: id=${params.id}, conversationId=${params.conversationId || 'none'}`)

      switch (params.id) {
        case 'compact': {
          if (!params.conversationId) {
            throw new Error('/compact requires an active conversation')
          }
          guardConversationIdle(params.conversationId)

          const ctrl = new AbortController()
          abortControllers.set(params.conversationId, ctrl)
          try {
            return await runCompact({
              appDataContext,
              conversationId: params.conversationId,
              instruction: params.argument,
              modelConfig: params.modelConfig,
              logger,
              abortSignal: ctrl.signal,
            })
          }
          finally {
            abortControllers.delete(params.conversationId)
          }
        }

        case 'new': {
          return runNew({ appDataContext, workspacePath: params.workspacePath, modelConfig: params.modelConfig })
        }

        case 'fork': {
          if (!params.conversationId) {
            throw new Error('/fork requires an active conversation')
          }
          guardConversationIdle(params.conversationId)
          return runFork({ appDataContext, sourceConversationId: params.conversationId, workspacePath: params.workspacePath })
        }

        default:
          throw new Error(`Unknown built-in command: ${params.id}`)
      }
    },
    cancelCommand,
  }
}
