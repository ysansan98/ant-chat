import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runBrowserTool, validateBrowserInput } from '../browserRunner'
import type { BrowserSessionState } from '../browserSessionManager'

describe('browserRunner 行为', () => {
  let root: string
  let agentBrowserPath: string
  let profilePath: string
  let artifactsPath: string
  let invocationsPath: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-browser-'))
    agentBrowserPath = path.join(root, 'agent-browser')
    profilePath = path.join(root, 'profile')
    artifactsPath = path.join(root, 'artifacts')
    invocationsPath = path.join(root, 'invocations.jsonl')
    fs.writeFileSync(agentBrowserPath, `#!/usr/bin/env node
const fs = require('node:fs')
let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => stdin += chunk)
process.stdin.on('end', () => {
  fs.appendFileSync(process.env.INVOCATIONS_PATH, JSON.stringify({ args: process.argv.slice(2), stdin, proxy: process.env.AGENT_BROWSER_PROXY, idle: process.env.AGENT_BROWSER_IDLE_TIMEOUT_MS, socket: process.env.AGENT_BROWSER_SOCKET_DIR, state: process.env.AGENT_BROWSER_STATE, key: process.env.AGENT_BROWSER_ENCRYPTION_KEY }) + '\\n')
  const delay = Number(process.env.DELAY_MS || 0)
  setTimeout(() => process.stdout.write('ok'), delay)
})
`)
    fs.chmodSync(agentBrowserPath, 0o755)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('注入持久 profile、direct session、proxy 和 daemon idle timeout', async () => {
    const result = await runBrowserTool({
      command: 'open',
      args: ['https://example.com'],
    }, {
      profilePath,
      artifactsPath,
      env: {
        PATH: browserPath(),
        INVOCATIONS_PATH: invocationsPath,
        HTTP_PROXY: 'http://localhost:7890',
      },
    })

    expect(result).toMatchObject({ ok: true, result: 'ok', diagnostics: { stdout: 'ok' } })
    const invocation = JSON.parse(fs.readFileSync(invocationsPath, 'utf8').trim())
    expect(invocation.args).toEqual([
      '--profile',
      profilePath,
      '--session',
      expect.stringMatching(/^ant-chat-direct-\d+$/),
      '--content-boundaries',
      'open',
      'https://example.com',
    ])
    expect(invocation.proxy).toBe('http://localhost:7890')
    expect(invocation.idle).toBe('300000')
    expect(invocation.socket).toContain('ant-chat-direct')
  })

  it('在 agent-browser 不可用时通过 npx 执行', async () => {
    const npxPath = path.join(root, 'npx')
    fs.renameSync(agentBrowserPath, npxPath)

    const result = await runBrowserTool({
      command: 'get title',
    }, {
      profilePath,
      artifactsPath,
      env: {
        PATH: browserPath(),
        INVOCATIONS_PATH: invocationsPath,
      },
    })

    expect(result).toMatchObject({ ok: true, result: 'ok', diagnostics: { stdout: 'ok' } })
    const invocation = JSON.parse(fs.readFileSync(invocationsPath, 'utf8').trim())
    expect(invocation.args).toEqual([
      'agent-browser',
      '--profile',
      profilePath,
      '--session',
      expect.stringMatching(/^ant-chat-direct-\d+$/),
      'get',
      'title',
    ])
  })

  it('从内部认证状态 provider 注入 state 和加密密钥', async () => {
    const statePath = path.join(root, 'auth-state.enc')
    const result = await runBrowserTool({ command: 'get title' }, {
      profilePath,
      artifactsPath,
      state: {
        sessionName: 'auth-session',
        socketPath: path.join(root, 'socket'),
        profilePath,
        headed: false,
        started: false,
        authState: { statePath, encryptionKey: 'a'.repeat(64) },
        queue: Promise.resolve(),
      },
      env: { PATH: browserPath(), INVOCATIONS_PATH: invocationsPath },
    })

    expect(result).toMatchObject({ ok: true })
    const invocation = JSON.parse(fs.readFileSync(invocationsPath, 'utf8').trim())
    expect(invocation.state).toBe(statePath)
    expect(invocation.key).toBe('a'.repeat(64))
  })

  it('显式系统 Profile 不混入应用托管认证状态', async () => {
    await runBrowserTool({ command: 'open', args: ['https://example.com', '--profile', 'Default'] }, {
      profilePath,
      artifactsPath,
      state: {
        sessionName: 'system-profile-session',
        socketPath: path.join(root, 'socket-system'),
        profilePath,
        headed: false,
        started: false,
        authState: { statePath: path.join(root, 'auth-state.enc'), encryptionKey: 'b'.repeat(64) },
        queue: Promise.resolve(),
      },
      env: { PATH: browserPath(), INVOCATIONS_PATH: invocationsPath },
    })

    const invocation = JSON.parse(fs.readFileSync(invocationsPath, 'utf8').trim())
    expect(invocation.state).toBeUndefined()
    expect(invocation.key).toBeUndefined()
  })

  it('agent-browser 和 npx 都不可用时返回安装错误', async () => {
    fs.rmSync(agentBrowserPath)

    const result = await runBrowserTool({
      command: 'get title',
    }, {
      profilePath,
      artifactsPath,
      env: { PATH: root },
    })

    expect(result).toEqual({
      ok: false,
      result: 'Browser tool failed: 未找到 agent-browser CLI。\n已检查系统 PATH 和 npx。请安装 agent-browser，并确保命令位于 PATH 中。',
      diagnostics: { durationMs: expect.any(Number) },
    })
  })

  it('缓存同一 PATH 的 agent-browser 发现结果', async () => {
    const options = {
      profilePath,
      artifactsPath,
      env: { PATH: browserPath(), INVOCATIONS_PATH: invocationsPath },
    }
    await expect(runBrowserTool({ command: 'get title' }, options)).resolves.toMatchObject({ ok: true })

    fs.rmSync(agentBrowserPath)

    await expect(runBrowserTool({ command: 'get title' }, options)).resolves.toMatchObject({
      ok: false,
      result: expect.stringContaining('未找到 agent-browser CLI'),
    })
  })

  it('用持久 Ant Chat profile 打开 headed browser 供手动登录', async () => {
    const state = createState()
    await runBrowserTool({
      command: 'open',
      args: ['--headed', 'https://example.com/login'],
    }, {
      profilePath,
      artifactsPath,
      env: { PATH: browserPath(), INVOCATIONS_PATH: invocationsPath },
      state,
    })
    await runBrowserTool({
      command: 'snapshot',
      args: ['-i'],
    }, {
      profilePath,
      artifactsPath,
      env: { PATH: browserPath(), INVOCATIONS_PATH: invocationsPath },
      state,
    })

    const invocations = fs.readFileSync(invocationsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(invocations[0].args).toEqual([
      '--profile',
      profilePath,
      '--session',
      'ant-chat-test',
      '--content-boundaries',
      '--headed',
      'open',
      'https://example.com/login',
    ])
    expect(invocations[1].args).toEqual([
      '--profile',
      profilePath,
      '--session',
      'ant-chat-test',
      '--headed',
      'snapshot',
      '-i',
    ])
    expect(invocations[0].stdin).toBe('')
  })

  it('关闭 browser 后重置 sticky headed 模式', async () => {
    const state = createState()
    const options = {
      profilePath,
      artifactsPath,
      env: { PATH: browserPath(), INVOCATIONS_PATH: invocationsPath },
      state,
    }

    await runBrowserTool({ command: 'open', args: ['--headed', 'https://example.com'] }, options)
    await runBrowserTool({ command: 'close' }, options)
    await runBrowserTool({ command: 'open', args: ['https://example.com'] }, options)

    const invocations = fs.readFileSync(invocationsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(invocations[1].args).toContain('--headed')
    expect(invocations[2].args).not.toContain('--headed')
  })

  it('从成功输出中移除 daemon 启动参数警告', async () => {
    fs.writeFileSync(agentBrowserPath, `#!/usr/bin/env node
process.stdout.write('page content\\n⚠ --profile, --headed ignored: daemon already running. Use close first.\\n')
`)
    fs.chmodSync(agentBrowserPath, 0o755)

    const result = await runBrowserTool({ command: 'snapshot' }, {
      profilePath,
      artifactsPath,
      env: { PATH: browserPath() },
    })

    expect(result).toMatchObject({ ok: true, result: 'page content', diagnostics: { stdout: 'page content' } })
  })

  it('同一 browser session 内串行执行命令', async () => {
    const first = runBrowserTool({ command: 'get title' }, {
      profilePath,
      artifactsPath,
      env: { PATH: browserPath(), INVOCATIONS_PATH: invocationsPath, DELAY_MS: '80' },
    })
    const second = runBrowserTool({ command: 'get url' }, {
      profilePath,
      artifactsPath,
      env: { PATH: browserPath(), INVOCATIONS_PATH: invocationsPath },
    })

    await Promise.all([first, second])

    const lines = fs.readFileSync(invocationsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(lines.map(item => item.args[item.args.length - 2])).toEqual(['get', 'get'])
  })

  it('拒绝不安全命令、本地 URL 和允许根目录外路径', () => {
    expect(validateBrowserInput({ command: 'cookies get' }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('command')
    expect(validateBrowserInput({ command: 'open', args: ['file:///etc/passwd'] }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('http')
    expect(validateBrowserInput({ command: 'screenshot', args: ['/tmp/out.png'] }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('output path')
    expect(validateBrowserInput({ command: 'open', args: ['https://example.com', '--extension', '/tmp/ext'] }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('--extension')
    expect(validateBrowserInput({ command: 'open', args: ['https://example.com', '--proxy', 'http://localhost:7890'] }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('--proxy')
    expect(validateBrowserInput({ command: 'auth save', args: ['github'] }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('command')
    expect(validateBrowserInput({ command: 'skills get', args: ['core'] }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('command')
  })

  it('允许显式指定命名 Chrome profile', () => {
    expect(validateBrowserInput({
      command: 'open',
      args: ['--profile', 'Default', 'https://example.com'],
    }, {
      workspacePath: root,
      artifactsPath,
    })).toBeNull()
  })

  it('允许受控页面执行和 compact snapshot 参数', () => {
    expect(validateBrowserInput({
      command: 'eval',
      args: ['document.body.innerText'],
    }, {
      workspacePath: root,
      artifactsPath,
    })).toBeNull()
    expect(validateBrowserInput({
      command: 'snapshot',
      args: ['-i', '-u', '-c', '-d', '3'],
    }, {
      workspacePath: root,
      artifactsPath,
    })).toBeNull()
  })

  it('移除全局参数后校验输出路径', () => {
    // screenshot with --profile should validate the actual output path, not the profile name
    expect(validateBrowserInput({
      command: 'screenshot',
      args: ['--profile', 'Default', '/tmp/out.png'],
    }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('output path')

    // valid output path with --profile should pass
    expect(validateBrowserInput({
      command: 'screenshot',
      args: ['--profile', 'Default', 'out.png'],
    }, {
      workspacePath: root,
      artifactsPath,
    })).toBeNull()
  })

  it('拒绝 --remote-debugging-port、--proxy-server、--disable-web-security、--user-data-dir', () => {
    expect(validateBrowserInput({ command: 'open', args: ['https://example.com', '--remote-debugging-port', '9222'] }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('--remote-debugging-port')
    expect(validateBrowserInput({ command: 'open', args: ['https://example.com', '--proxy-server', 'http://localhost:8080'] }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('--proxy-server')
    expect(validateBrowserInput({ command: 'open', args: ['https://example.com', '--disable-web-security'] }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('--disable-web-security')
    expect(validateBrowserInput({ command: 'open', args: ['https://example.com', '--user-data-dir', '/tmp/chrome'] }, {
      workspacePath: root,
      artifactsPath,
    })).toContain('--user-data-dir')
  })

  it('proxyUrl 选项优先于环境代理变量', async () => {
    const result = await runBrowserTool({
      command: 'open',
      args: ['https://example.com'],
    }, {
      profilePath,
      artifactsPath,
      proxyUrl: 'http://explicit-proxy:8080',
      env: {
        PATH: browserPath(),
        INVOCATIONS_PATH: invocationsPath,
        HTTP_PROXY: 'http://env-proxy:7890',
      },
    })

    expect(result).toMatchObject({ ok: true, result: 'ok', diagnostics: { stdout: 'ok' } })
    const invocation = JSON.parse(fs.readFileSync(invocationsPath, 'utf8').trim())
    expect(invocation.proxy).toBe('http://explicit-proxy:8080')
  })

  function createState(): BrowserSessionState {
    return {
      sessionName: 'ant-chat-test',
      socketPath: path.join(root, 'socket'),
      profilePath,
      headed: false,
      started: false,
      profile: undefined,
      queue: Promise.resolve(),
    }
  }

  function browserPath(): string {
    return [root, path.dirname(process.execPath)].join(path.delimiter)
  }
})
