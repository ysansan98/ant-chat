import type { HookHandlerExecution, HookInput } from '../types'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HookConfigStore } from '../hookConfigStore'
import { createHookDispatcher } from '../hookDispatcher'
import { createHookRunner } from '../hookRunner'

const baseInput: HookInput = {
  hook_event_name: 'PreToolUse',
  session_id: 'conv-1',
  conversation_id: 'conv-1',
  cwd: '/tmp/workspace',
  timestamp: 1,
}

describe('createHookDispatcher', () => {
  let root: string
  let globalFilePath: string
  let workspacePath: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-hook-dispatch-'))
    globalFilePath = path.join(root, 'hooks.json')
    workspacePath = path.join(root, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  function write(config: unknown) {
    fs.writeFileSync(globalFilePath, JSON.stringify(config), 'utf8')
  }

  function execution(overrides: Partial<HookHandlerExecution> & { command: string }): HookHandlerExecution {
    return {
      event: 'PreToolUse',
      source: 'global',
      exitCode: 0,
      timedOut: false,
      durationMs: 1,
      ...overrides,
    }
  }

  function createDispatcher(runHandler: (command: string) => Promise<HookHandlerExecution> | HookHandlerExecution) {
    const store = new HookConfigStore({ globalFilePath })
    const runner = {
      runHandler: vi.fn(async (request: { handler: { command: string } }) => await runHandler(request.handler.command)),
    }
    return { dispatcher: createHookDispatcher({ store, runner }), runner }
  }

  it('无配置时返回空结果且不执行任何 handler', async () => {
    const { dispatcher, runner } = createDispatcher(() => {
      throw new Error('should not run')
    })
    const result = await dispatcher.run('PreToolUse', baseInput, { cwd: workspacePath })
    expect(result.decision).toBeUndefined()
    expect(result.executions).toEqual([])
    expect(runner.runHandler).not.toHaveBeenCalled()
  })

  it('matcher 命中才执行', async () => {
    write({
      schemaVersion: 1,
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'bash.sh' }] },
          { hooks: [{ type: 'command', command: 'always.sh' }] },
        ],
      },
    })
    const { dispatcher, runner } = createDispatcher(command => execution({ command }))
    await dispatcher.run('PreToolUse', { ...baseInput, tool_name: 'WriteFile' }, { cwd: workspacePath })
    expect(runner.runHandler).toHaveBeenCalledTimes(1)
    expect(runner.runHandler.mock.calls[0]![0].handler.command).toBe('always.sh')
  })

  it('matcher 为 * 匹配全部', async () => {
    write({
      schemaVersion: 1,
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'all.sh' }] }] },
    })
    const { dispatcher, runner } = createDispatcher(command => execution({ command }))
    await dispatcher.run('PreToolUse', { ...baseInput, tool_name: 'Bash' }, { cwd: workspacePath })
    expect(runner.runHandler).toHaveBeenCalledTimes(1)
  })

  it('无效 regex 不匹配且不抛错', async () => {
    write({
      schemaVersion: 1,
      hooks: { PreToolUse: [{ matcher: '[', hooks: [{ type: 'command', command: 'bad.sh' }] }] },
    })
    const { dispatcher, runner } = createDispatcher(command => execution({ command }))
    const result = await dispatcher.run('PreToolUse', { ...baseInput, tool_name: 'Bash' }, { cwd: workspacePath })
    expect(result.executions).toEqual([])
    expect(runner.runHandler).not.toHaveBeenCalled()
  })

  it('聚合优先级 deny > ask > allow', async () => {
    write({
      schemaVersion: 1,
      hooks: {
        PreToolUse: [{
          hooks: [
            { type: 'command', command: 'allow.sh' },
            { type: 'command', command: 'ask.sh' },
            { type: 'command', command: 'deny.sh' },
          ],
        }],
      },
    })
    const { dispatcher } = createDispatcher((command) => {
      if (command === 'allow.sh')
        return execution({ command, decision: 'allow' })
      if (command === 'ask.sh')
        return execution({ command, decision: 'ask', reason: 'ask 原因' })
      return execution({ command, decision: 'block', reason: 'deny 原因' })
    })
    const result = await dispatcher.run('PreToolUse', baseInput, { cwd: workspacePath })
    expect(result.decision).toBe('deny')
    expect(result.reason).toBe('deny 原因')
  })

  it('无 deny 时 ask 优先于 allow', async () => {
    write({
      schemaVersion: 1,
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'a.sh' }, { type: 'command', command: 'b.sh' }] }] },
    })
    const { dispatcher } = createDispatcher(command => execution({
      command,
      decision: command === 'a.sh' ? 'allow' : 'ask',
    }))
    const result = await dispatcher.run('PreToolUse', baseInput, { cwd: workspacePath })
    expect(result.decision).toBe('ask')
  })

  it('全部无决策时不干预', async () => {
    write({
      schemaVersion: 1,
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'observe.sh' }] }] },
    })
    const { dispatcher } = createDispatcher(command => execution({ command, error: 'x' }))
    const result = await dispatcher.run('PreToolUse', baseInput, { cwd: workspacePath })
    expect(result.decision).toBeUndefined()
    expect(result.executions).toHaveLength(1)
  })

  it('additionalContext 拼接', async () => {
    write({
      schemaVersion: 1,
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'a.sh' }, { type: 'command', command: 'b.sh' }] }] },
    })
    const { dispatcher } = createDispatcher(command => execution({ command, additionalContext: `${command} ctx` }))
    const result = await dispatcher.run('PreToolUse', baseInput, { cwd: workspacePath })
    expect(result.additionalContext).toBe('a.sh ctx\nb.sh ctx')
  })

  it('并发执行全部匹配 handler', async () => {
    write({
      schemaVersion: 1,
      hooks: {
        PreToolUse: [{ hooks: [
          { type: 'command', command: 'a.sh' },
          { type: 'command', command: 'b.sh' },
          { type: 'command', command: 'c.sh' },
        ] }],
      },
    })
    let active = 0
    let peak = 0
    const { dispatcher } = createDispatcher(async (command) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      return execution({ command })
    })
    await dispatcher.run('PreToolUse', baseInput, { cwd: workspacePath })
    expect(peak).toBeGreaterThan(1)
  })

  it('global 与 workspace 匹配项都执行', async () => {
    write({
      schemaVersion: 1,
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'global.sh' }] }] },
    })
    fs.mkdirSync(path.join(workspacePath, '.agents'), { recursive: true })
    fs.writeFileSync(path.join(workspacePath, '.agents', 'hooks.json'), JSON.stringify({
      schemaVersion: 1,
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'workspace.sh' }] }] },
    }), 'utf8')

    const { dispatcher, runner } = createDispatcher(command => execution({ command }))
    await dispatcher.run('PreToolUse', baseInput, { cwd: workspacePath })
    expect(runner.runHandler.mock.calls.map(call => call[0].handler.command).sort()).toEqual(['global.sh', 'workspace.sh'])
  })

  it('preCompact continue:false 透传，任一 false 生效', async () => {
    write({
      schemaVersion: 1,
      hooks: { PreCompact: [{ hooks: [{ type: 'command', command: 'a.sh' }, { type: 'command', command: 'b.sh' }] }] },
    })
    const { dispatcher } = createDispatcher(command => execution({
      command,
      event: 'PreCompact',
      continue: command !== 'b.sh',
    }))
    const result = await dispatcher.run('PreCompact', { ...baseInput, hook_event_name: 'PreCompact' }, { cwd: workspacePath })
    expect(result.continue).toBe(false)
  })

  it('使用真实 runner 时 hook 崩溃不影响其他 handler 聚合', async () => {
    write({
      schemaVersion: 1,
      hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'bad.sh' }, { type: 'command', command: 'deny.sh' }] }] },
    })
    const store = new HookConfigStore({ globalFilePath })
    const runner = createHookRunner({
      executor: async (context) => {
        if (context.command === 'bad.sh')
          throw new Error('boom')
        return { exitCode: 2, stdout: '', stderr: '拒绝', timedOut: false, durationMs: 1 }
      },
    })
    const dispatcher = createHookDispatcher({ store, runner })
    const result = await dispatcher.run('PreToolUse', baseInput, { cwd: workspacePath })
    expect(result.decision).toBe('deny')
    expect(result.executions.find(item => item.command === 'bad.sh')?.error).toBe('boom')
  })
})
