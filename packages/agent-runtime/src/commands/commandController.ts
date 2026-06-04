import type { AppDataContext } from '@ant-chat/app-data'
import type { AgentTaskSnapshot, IAgentEventEmitter, ILogger, RunBuiltinCommandParams, RunBuiltinCommandResult } from '@ant-chat/shared'
import { runCompact } from './compactCommand'
import { runNew } from './conversationCommands'
import { runFork } from './messageFork'

export interface CommandControllerDeps {
  appDataContext: AppDataContext
  eventEmitter: IAgentEventEmitter
  logger?: ILogger
  /** Must return active tasks for the given conversation. Used for concurrency guard. */
  listActiveTasks: (conversationId?: string) => AgentTaskSnapshot[]
}

export interface CommandController {
  runBuiltinCommand: (params: RunBuiltinCommandParams) => Promise<RunBuiltinCommandResult>
}

export function createCommandController(deps: CommandControllerDeps): CommandController {
  const { appDataContext, eventEmitter: _eventEmitter, logger, listActiveTasks } = deps

  function log(msg: string) {
    logger?.info(`[command-controller] ${msg}`)
  }

  function guardConversationIdle(conversationId: string) {
    const active = listActiveTasks(conversationId)
    if (active.some(t => ['running', 'awaiting_approval'].includes(t.status))) {
      throw new Error('Agent task is running, cannot execute command')
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
          return runCompact({ appDataContext, conversationId: params.conversationId, instruction: params.argument, modelConfig: params.modelConfig, logger })
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
  }
}
