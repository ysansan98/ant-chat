import type { AgentRuntimeConfig, BackgroundCommandSummary, IAgentEventEmitter, ILogger } from '@ant-chat/shared'
import type { AgentCommandPaths } from '../../agentCommands'
import type { PreparedCommandState } from '../native-tools/command/types'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackgroundCommandManager } from '../native-tools/command/backgroundCommandManager'
import { SessionRuntime } from '../session/SessionRuntime'
import { TaskStore } from '../taskStore'

let root: string
let workspacePath: string
let paths: AgentCommandPaths

beforeEach(() => {
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-life-ws-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-life-cmd-'))
  paths = { root, logsPath: path.join(root, 'logs'), statePath: path.join(root, 'state') }
})

afterEach(() => {
  fs.rmSync(workspacePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

function createConfig(emitter: IAgentEventEmitter): AgentRuntimeConfig {
  return {
    commandHost: {
      status: 'available',
      platform: 'posix',
      adapter: 'bash',
      interpreter: 'bash',
      executablePath: '/bin/bash',
      environment: { PATH: process.env.PATH ?? '', HOME: os.homedir() },
    },
    commandPaths: paths,
    eventEmitter: emitter,
    logger: createLogger(),
  }
}

function createLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function createEmitter() {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
    emitTurnFinished: vi.fn(),
    emitMessageUpdated: vi.fn(),
    emitBackgroundCommandsUpdated: vi.fn(),
  }
}

function createLongRunningPrepared(): PreparedCommandState {
  return {
    kind: 'command',
    interpreter: 'bash',
    input: { command: 'node -e setInterval' },
    command: 'node -e setInterval',
    cwd: workspacePath,
    segments: [],
    resourceScope: 'workspace',
    isReadOnly: false,
    hasSecretEnv: false,
    risk: 'ordinary',
    executionPlan: {
      executablePath: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: workspacePath,
      environment: { PATH: process.env.PATH ?? '', HOME: os.homedir() },
    },
    adapterState: {},
  }
}

function getManager(runtime: SessionRuntime): BackgroundCommandManager {
  return (runtime as unknown as { backgroundCommands: BackgroundCommandManager }).backgroundCommands
}

describe('后台命令生命周期集成', () => {
  it('会话级 manager 跨 turn 存活，会话关闭时回收', async () => {
    const emitter = createEmitter()
    const runtime = new SessionRuntime(createConfig(emitter), new TaskStore())
    const manager = getManager(runtime)
    const started = manager.start('conv-1', createLongRunningPrepared(), {})
    if (!started.ok)
      throw new Error(started.reason)

    // 模拟 turn 结束：Runtime 不提供任何终止入口，命令继续运行
    await vi.waitFor(() => {
      expect(manager.list('conv-1')[0]?.status).toBe('running')
    })

    // 变更事件推送到渲染层
    expect(emitter.emitBackgroundCommandsUpdated).toHaveBeenCalledWith('conv-1', expect.any(Array))
    const snapshot = emitter.emitBackgroundCommandsUpdated.mock.calls.at(-1)?.[1] as BackgroundCommandSummary[]
    expect(snapshot[0]?.commandId).toBe(started.summary.commandId)

    // 新 turn 仍可读输出（这里以真 Run 时间证明进程存活）
    const read = await manager.read('conv-1', started.summary.commandId, {})
    expect(read.status).toBe('running')

    await runtime.closeConversation('conv-1')
    expect(manager.list('conv-1')).toEqual([])
  })

  it('dispose 终止全部会话的后台命令并清理状态文件', async () => {
    const runtime = new SessionRuntime(createConfig(createEmitter()), new TaskStore())
    const manager = getManager(runtime)
    const started = manager.start('conv-1', createLongRunningPrepared(), {})
    if (!started.ok)
      throw new Error(started.reason)

    const statePath = path.join(paths.statePath, `${started.summary.commandId}.json`)
    await vi.waitFor(() => {
      expect(fs.existsSync(statePath)).toBe(true)
    })

    await runtime.dispose()

    expect(manager.list('conv-1')).toEqual([])
    await vi.waitFor(() => {
      expect(fs.existsSync(statePath)).toBe(false)
    })
  })
})
