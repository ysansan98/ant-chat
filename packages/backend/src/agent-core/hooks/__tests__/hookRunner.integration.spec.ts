import type { HookCommandExecutor } from '../hookRunner'
import type { HookInput } from '../types'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectCommandHost } from '../../../app-runtime/commandHost'
import { HookConfigStore } from '../hookConfigStore'
import { createHookDispatcher } from '../hookDispatcher'
import { createCommandHostHookExecutor, createHookRunner } from '../hookRunner'

const host = detectCommandHost()
const runIntegration = host.status === 'available' ? describe : describe.skip

/**
 * 真实命令宿主集成测试：覆盖 `command` handler 的 spawn、stdin、超时与 exit code 语义。
 * 这些是计划 §7 手工场景的自动化固化（脚本级）。
 */
runIntegration('hooks 真实执行（command host）', () => {
  let root: string
  let globalFilePath: string
  let workspacePath: string
  let executor: HookCommandExecutor

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-hook-int-'))
    globalFilePath = path.join(root, 'hooks.json')
    workspacePath = path.join(root, 'workspace')
    fs.mkdirSync(workspacePath, { recursive: true })
    executor = createCommandHostHookExecutor(host as never)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const baseInput: HookInput = {
    hook_event_name: 'PreToolUse',
    session_id: 'conv-1',
    conversation_id: 'conv-1',
    cwd: '/tmp',
    timestamp: 1,
    tool_name: 'execute_command',
  }

  function writeScript(name: string, source: string): string {
    const filePath = path.join(root, name)
    fs.writeFileSync(filePath, source, 'utf8')
    return filePath
  }

  it('脚本可读取 stdin JSON 并返回 deny', async () => {
    const script = writeScript('deny.mjs', `
      let input = ''
      process.stdin.on('data', chunk => { input += chunk })
      process.stdin.on('end', () => {
        const parsed = JSON.parse(input)
        process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'blocked ' + parsed.tool_name }))
      })
    `)
    const runner = createHookRunner({ executor })
    const result = await runner.runHandler({
      event: 'PreToolUse',
      source: 'global',
      handler: { type: 'command', command: `node ${script}` },
      input: baseInput,
      cwd: workspacePath,
    })
    expect(result.decision).toBe('deny')
    expect(result.reason).toBe('blocked execute_command')
    expect(result.exitCode).toBe(0)
  })

  it('exit code 2 拒绝且 stderr 作为原因', async () => {
    const script = writeScript('exit2.mjs', `
      process.stderr.write('禁止 rm -rf\\n')
      process.exit(2)
    `)
    const runner = createHookRunner({ executor })
    const result = await runner.runHandler({
      event: 'PreToolUse',
      source: 'global',
      handler: { type: 'command', command: `node ${script}` },
      input: baseInput,
      cwd: workspacePath,
    })
    expect(result.decision).toBe('deny')
    expect(result.reason).toBe('禁止 rm -rf')
  })

  it('超时被中止且按无决策处理', async () => {
    const script = writeScript('slow.mjs', `setTimeout(() => { process.stdout.write('{}') }, 5000)`)
    const runner = createHookRunner({ executor })
    const startedAt = Date.now()
    const result = await runner.runHandler({
      event: 'PreToolUse',
      source: 'global',
      handler: { type: 'command', command: `node ${script}`, timeout: 300 },
      input: baseInput,
      cwd: workspacePath,
    })
    expect(result.timedOut).toBe(true)
    expect(result.decision).toBeUndefined()
    expect(Date.now() - startedAt).toBeLessThan(3000)
  })

  it('审计脚本记录工具输入到本地文件', async () => {
    const auditFile = path.join(root, 'audit.log')
    const script = writeScript('audit.mjs', `
      import { appendFileSync } from 'node:fs'
      let input = ''
      process.stdin.on('data', chunk => { input += chunk })
      process.stdin.on('end', () => {
        appendFileSync(process.argv[2], input + '\\n')
        process.stdout.write('{}')
      })
    `)
    const runner = createHookRunner({ executor })
    await runner.runHandler({
      event: 'PostToolUse',
      source: 'global',
      handler: { type: 'command', command: `node ${script} ${auditFile}` },
      input: { ...baseInput, hook_event_name: 'PostToolUse', result: 'ok' },
      cwd: workspacePath,
    })
    const logged = fs.readFileSync(auditFile, 'utf8').trim()
    expect(JSON.parse(logged)).toMatchObject({ hook_event_name: 'PostToolUse', tool_name: 'execute_command' })
  })

  it('dispatcher 走真实配置：deny 阻断、观察类放行', async () => {
    const denyScript = writeScript('deny.mjs', `process.exit(2)`)
    fs.writeFileSync(globalFilePath, JSON.stringify({
      schemaVersion: 1,
      hooks: { PreToolUse: [{ matcher: 'execute_command', hooks: [{ type: 'command', command: `node ${denyScript}` }] }] },
    }), 'utf8')

    const store = new HookConfigStore({ globalFilePath })
    const runner = createHookRunner({ executor })
    const dispatcher = createHookDispatcher({ store, runner })

    const result = await dispatcher.run('PreToolUse', baseInput, { cwd: workspacePath })
    expect(result.decision).toBe('deny')
  })
})
