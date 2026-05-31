import type { AppDataContext } from '@ant-chat/app-data'
import type { IAgentEventEmitter } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { createAgentRuntimeEnvironmentFromContext } from '../environment'
import { createAgentRuntimePaths } from '../paths'

const eventEmitter: IAgentEventEmitter = {
  emitTaskUpdated: vi.fn(),
  emitApprovalRequired: vi.fn(),
  emitTurnStarted: vi.fn(),
  emitTurnChunk: vi.fn(),
  emitTurnToolCalls: vi.fn(),
  emitTurnFinished: vi.fn(),
}

function createFakeAppDataContext(): AppDataContext {
  return {
    conversationRepository: {},
    messageRepository: {},
    messageSearchQuery: {},
    settingsRepository: {},
    providerSettingsRepository: {},
    modelCatalog: {
      getModelById: vi.fn(),
      getProviderById: vi.fn(),
    },
    mcpSettingsRepository: {},
    toolApprovalWhitelistRepository: {
      getAll: vi.fn(() => []),
      add: vi.fn(),
    },
    workspaceService: {
      getCurrentWorkspacePath: vi.fn(() => '/workspace'),
    },
  } as unknown as AppDataContext
}

describe('createAgentRuntimeEnvironmentFromContext', () => {
  it('assembles runtime services without opening a database', () => {
    const paths = createAgentRuntimePaths('/data/ant-chat')
    const env = createAgentRuntimeEnvironmentFromContext({
      paths,
      appDataContext: createFakeAppDataContext(),
      eventEmitter,
    })

    expect(env.db).toBeUndefined()
    expect(env.paths).toBe(paths)
    expect(env.skillManagementService.getSkillsRoot()).toBe(paths.skillsRoot)
    expect(env.runtime).toBeDefined()
    expect(env.agentController).toBeDefined()
  })
})
