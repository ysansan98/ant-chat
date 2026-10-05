import type { HookCommandExecutionOutcome, HookCommandExecutor } from '../hookRunner'
import type { HookInput } from '../types'
import { describe, expect, it, vi } from 'vitest'
import { createHookRunner } from '../hookRunner'

const input: HookInput = {
  hook_event_name: 'PreToolUse',
  session_id: 'conv-1',
  conversation_id: 'conv-1',
  cwd: '/tmp/workspace',
  timestamp: 1,
}

function executor(outcome: Partial<HookCommandExecutionOutcome>): HookCommandExecutor {
  return async () => ({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    durationMs: 5,
    ...outcome,
  })
}

function run(executorImpl: HookCommandExecutor, event: HookInput['hook_event_name'] = 'PreToolUse') {
  return createHookRunner({ executor: executorImpl }).runHandler({
    event,
    source: 'global',
    handler: { type: 'command', command: 'hook.sh' },
    input: { ...input, hook_event_name: event },
    cwd: input.cwd,
  })
}

describe('createHookRunner', () => {
  it('exit code 2 视为 deny，stderr 作为 reason', async () => {
    const result = await run(executor({ exitCode: 2, stderr: '禁止 rm -rf\n' }))
    expect(result.decision).toBe('deny')
    expect(result.reason).toBe('禁止 rm -rf')
    expect(result.continue).toBe(false)
  })

  it('exit code 2 时结构化 reason 优先于 stderr', async () => {
    const result = await run(executor({ exitCode: 2, stdout: JSON.stringify({ reason: '结构化原因' }), stderr: 'stderr 原因' }))
    expect(result.reason).toBe('结构化原因')
  })

  it('stdout JSON 的 decision/reason/additionalContext 被解析', async () => {
    const result = await run(executor({
      exitCode: 0,
      stdout: JSON.stringify({ decision: 'ask', reason: '需要确认', additionalContext: '补充上下文' }),
    }))
    expect(result.decision).toBe('ask')
    expect(result.reason).toBe('需要确认')
    expect(result.additionalContext).toBe('补充上下文')
  })

  it('jSON 中的 continue:false（PreCompact 语义）被解析', async () => {
    const result = await run(executor({ exitCode: 0, stdout: JSON.stringify({ continue: false }) }), 'PreCompact')
    expect(result.continue).toBe(false)
  })

  it('非零且非 2 退出按无决策处理，仅记 error', async () => {
    const result = await run(executor({ exitCode: 3, stderr: '脚本自身错误' }))
    expect(result.decision).toBeUndefined()
    expect(result.error).toContain('3')
  })

  it('超时按无决策处理', async () => {
    const result = await run(executor({ exitCode: null, timedOut: true }))
    expect(result.decision).toBeUndefined()
    expect(result.error).toBe('hook_timeout')
    expect(result.timedOut).toBe(true)
  })

  it('进程启动失败按无决策处理', async () => {
    const result = await run(executor({ exitCode: null, error: 'spawn ENOENT' }))
    expect(result.decision).toBeUndefined()
    expect(result.error).toBe('spawn ENOENT')
  })

  it('executor 抛错被吞掉，按无决策处理', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const result = await createHookRunner({
      executor: async () => { throw new Error('boom') },
      logger,
    }).runHandler({ event: 'PreToolUse', source: 'global', handler: { type: 'command', command: 'x' }, input, cwd: input.cwd })
    expect(result.decision).toBeUndefined()
    expect(result.error).toBe('boom')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('向 executor 传入事件、超时与 stdin JSON', async () => {
    const seen: Array<Record<string, unknown>> = []
    const capture: HookCommandExecutor = async (context) => {
      seen.push({ event: context.event, timeoutMs: context.timeoutMs, stdin: context.stdin, env: context.env })
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1 }
    }
    await createHookRunner({ executor: capture }).runHandler({
      event: 'PreToolUse',
      source: 'global',
      handler: { type: 'command', command: 'hook.sh' },
      input,
      cwd: input.cwd,
    })
    expect(seen[0].event).toBe('PreToolUse')
    expect(seen[0].timeoutMs).toBe(10_000)
    expect(JSON.parse(String(seen[0].stdin))).toMatchObject({ hook_event_name: 'PreToolUse', session_id: 'conv-1' })
    expect(seen[0].env).toMatchObject({ HOOK_EVENT: 'PreToolUse' })
  })

  it('单条 timeout 覆盖默认值', async () => {
    let timeoutMs = 0
    await createHookRunner({
      executor: async (context) => {
        timeoutMs = context.timeoutMs
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1 }
      },
    }).runHandler({
      event: 'PreToolUse',
      source: 'global',
      handler: { type: 'command', command: 'hook.sh', timeout: 1500 },
      input,
      cwd: input.cwd,
    })
    expect(timeoutMs).toBe(1500)
  })
})
