import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isReadOnlyBashCommand, preValidateBashScope, runBashTool } from '../bashRunner'

describe('preValidateBashScope 行为', () => {
  let workspacePath: string
  let skillPath: string

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-bashscope-'))
    skillPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-bashscope-skill-'))
  })

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true })
    fs.rmSync(skillPath, { recursive: true, force: true })
  })

  describe('blocked — 直接拦截（无法解析）', () => {
    it('空命令', () => {
      expect(preValidateBashScope({ command: '' }, workspacePath)).toBe('blocked')
    })

    it('仅空白', () => {
      expect(preValidateBashScope({ command: '   ' }, workspacePath)).toBe('blocked')
    })

    it('browser 工具可用时禁止绕过调用 agent-browser', () => {
      expect(preValidateBashScope(
        { command: 'agent-browser snapshot -i' },
        workspacePath,
        { blockAgentBrowser: true },
      )).toBe('blocked')
      expect(preValidateBashScope(
        { command: 'npx --yes agent-browser get title' },
        workspacePath,
        { blockAgentBrowser: true },
      )).toBe('blocked')
    })
  })

  describe('outside — 需用户审批', () => {
    it('显式工作区外路径的 rm 命令', () => {
      expect(preValidateBashScope({ command: 'rm -rf /tmp/outside' }, workspacePath)).toBe('outside')
    })

    it('禁用命令: sudo', () => {
      expect(preValidateBashScope({ command: 'sudo ls' }, workspacePath)).toBe('outside')
    })

    it('禁用命令: curl/npm/pip', () => {
      expect(preValidateBashScope({ command: 'curl http://example.com' }, workspacePath)).toBe('outside')
      expect(preValidateBashScope({ command: 'npm install' }, workspacePath)).toBe('outside')
      expect(preValidateBashScope({ command: 'pip install foo' }, workspacePath)).toBe('outside')
    })

    it('管道 |', () => {
      expect(preValidateBashScope({ command: 'pwd | cat' }, workspacePath)).toBe('outside')
    })

    it('重定向 >', () => {
      expect(preValidateBashScope({ command: 'find . > /tmp/out' }, workspacePath)).toBe('outside')
    })

    it('mkdir 缺少 -p', () => {
      expect(preValidateBashScope({ command: 'mkdir src' }, workspacePath)).toBe('outside')
    })

    it('read-only 命令访问绝对路径', () => {
      expect(preValidateBashScope({ command: 'find /Users/ysansan -name "*.pdf"' }, workspacePath)).toBe('outside')
    })

    it('read-only 命令使用 ~', () => {
      expect(preValidateBashScope({ command: 'find ~/Documents -name "*.pdf"' }, workspacePath)).toBe('outside')
    })

    it('read-only 命令使用 .. 路径逃逸', () => {
      expect(preValidateBashScope({ command: 'cat ../outside/file.txt' }, workspacePath)).toBe('outside')
    })

    it('cwd 在工作区外', () => {
      expect(preValidateBashScope({ command: 'ls', cwd: '/Users/ysansan' }, workspacePath)).toBe('outside')
    })
  })

  describe('workspace — 安全放行', () => {
    it('环境探测命令判定为只读且留在工作区范围', () => {
      const command = 'which node && node --version'

      expect(isReadOnlyBashCommand(command)).toBe(true)
      expect(preValidateBashScope({ command }, workspacePath)).toBe('workspace')
    })

    it('环境探测命令可真实执行', async () => {
      const result = await runBashTool({ command: 'which node && node --version' }, workspacePath)

      expect(result.ok).toBe(true)
      expect(result.diagnostics?.stdout).toContain('node')
    })

    it('node 的版本参数不能夹带脚本执行', () => {
      expect(isReadOnlyBashCommand('node --version')).toBe(true)
      expect(isReadOnlyBashCommand('node -v --run build')).toBe(false)
      expect(preValidateBashScope({ command: 'node -v --run build' }, workspacePath)).toBe('workspace')
    })

    it('只读分类不会放行会启动子进程或写入文件的搜索参数', () => {
      expect(isReadOnlyBashCommand('rg --pre formatter query')).toBe(false)
      expect(isReadOnlyBashCommand('find . -exec rm {} \\;')).toBe(false)
    })

    it('工作区内的非只读命令不应被误判为工作区外', () => {
      expect(preValidateBashScope({ command: 'git status' }, workspacePath)).toBe('workspace')
    })

    it('pwd 判定为 workspace', () => {
      expect(preValidateBashScope({ command: 'pwd' }, workspacePath)).toBe('workspace')
    })

    it('ls 无参数', () => {
      expect(preValidateBashScope({ command: 'ls' }, workspacePath)).toBe('workspace')
    })

    it('ls -la 相对路径', () => {
      expect(preValidateBashScope({ command: 'ls -la ./src' }, workspacePath)).toBe('workspace')
    })

    it('find . -name 判定为 workspace', () => {
      expect(preValidateBashScope({ command: 'find . -name "*.ts"' }, workspacePath)).toBe('workspace')
    })

    it('cat file.txt 判定为 workspace', () => {
      expect(preValidateBashScope({ command: 'cat file.txt' }, workspacePath)).toBe('workspace')
    })

    it('rg pattern . 判定为 workspace', () => {
      expect(preValidateBashScope({ command: 'rg foo .' }, workspacePath)).toBe('workspace')
    })

    it('mkdir -p 工作区内新目录', () => {
      expect(preValidateBashScope({ command: 'mkdir -p src/nested' }, workspacePath)).toBe('workspace')
    })

    it('已信任 Skill 根目录内的非只读命令判定为 workspace', () => {
      fs.writeFileSync(path.join(skillPath, 'run.js'), 'console.log("ok")\n')

      expect(preValidateBashScope(
        { command: `${process.execPath} run.js`, cwd: skillPath },
        workspacePath,
        { trustedPaths: [skillPath] },
      )).toBe('workspace')
    })

    it('未信任 Skill 根目录时相同命令仍判定为 outside', () => {
      fs.writeFileSync(path.join(skillPath, 'run.js'), 'console.log("ok")\n')

      expect(preValidateBashScope(
        { command: `${process.execPath} run.js`, cwd: skillPath },
        workspacePath,
      )).toBe('outside')
    })

    it('已信任 Skill 根目录内的命令可真实执行', async () => {
      fs.writeFileSync(path.join(skillPath, 'run.js'), 'console.log("skill-runtime-ok")\n')

      const result = await runBashTool(
        { command: `${process.execPath} run.js`, cwd: skillPath },
        workspacePath,
        false,
        { trustedPaths: [skillPath] },
      )

      expect(result.ok).toBe(true)
      expect(result.diagnostics?.stdout).toContain('skill-runtime-ok')
    })
  })
})
