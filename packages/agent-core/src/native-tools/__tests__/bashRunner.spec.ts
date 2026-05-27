import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { preValidateBashScope } from '../tools/bashRunner'

describe('preValidateBashScope', () => {
  let workspacePath: string

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-bashscope-'))
  })

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true })
  })

  describe('blocked — 直接拦截（无法解析）', () => {
    it('空命令', () => {
      expect(preValidateBashScope({ command: '' }, workspacePath)).toBe('blocked')
    })

    it('仅空白', () => {
      expect(preValidateBashScope({ command: '   ' }, workspacePath)).toBe('blocked')
    })
  })

  describe('outside — 需用户审批', () => {
    it('禁用命令: rm', () => {
      expect(preValidateBashScope({ command: 'rm -rf src' }, workspacePath)).toBe('outside')
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

    it('非只读命令: git', () => {
      expect(preValidateBashScope({ command: 'git status' }, workspacePath)).toBe('outside')
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
    it('pwd', () => {
      expect(preValidateBashScope({ command: 'pwd' }, workspacePath)).toBe('workspace')
    })

    it('ls 无参数', () => {
      expect(preValidateBashScope({ command: 'ls' }, workspacePath)).toBe('workspace')
    })

    it('ls -la 相对路径', () => {
      expect(preValidateBashScope({ command: 'ls -la ./src' }, workspacePath)).toBe('workspace')
    })

    it('find . -name', () => {
      expect(preValidateBashScope({ command: 'find . -name "*.ts"' }, workspacePath)).toBe('workspace')
    })

    it('cat file.txt', () => {
      expect(preValidateBashScope({ command: 'cat file.txt' }, workspacePath)).toBe('workspace')
    })

    it('rg pattern .', () => {
      expect(preValidateBashScope({ command: 'rg foo .' }, workspacePath)).toBe('workspace')
    })

    it('mkdir -p 工作区内新目录', () => {
      expect(preValidateBashScope({ command: 'mkdir -p src/nested' }, workspacePath)).toBe('workspace')
    })
  })
})
