import type { AppDataServices } from '@ant-chat/app-data'
import type { IAgentEventEmitter } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { createAgentRuntimeEnvironmentFromServices } from '../environment'
import { createAgentRuntimePaths } from '../paths'

const eventEmitter: IAgentEventEmitter = {
  emitTaskUpdated: vi.fn(),
  emitApprovalRequired: vi.fn(),
  emitTurnStarted: vi.fn(),
  emitTurnChunk: vi.fn(),
  emitTurnToolCalls: vi.fn(),
  emitTurnFinished: vi.fn(),
}

function createFakeAppDataServices(): AppDataServices {
  return {
    conversationService: {},
    messageService: {},
    messageSearchService: {},
    settingsService: {},
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
  } as unknown as AppDataServices
}

describe('createAgentRuntimeEnvironmentFromServices', () => {
  it('assembles runtime services without opening a database', () => {
    const paths = createAgentRuntimePaths('/data/ant-chat')
    const env = createAgentRuntimeEnvironmentFromServices({
      paths,
      appDataServices: createFakeAppDataServices(),
      eventEmitter,
    })

    expect(env.db).toBeUndefined()
    expect(env.paths).toBe(paths)
    expect(env.skillManagementService.getSkillsRoot()).toBe(paths.skillsRoot)
    expect(env.runtime).toBeDefined()
    expect(env.agentService).toBeDefined()
  })
})
