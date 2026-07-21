import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AGENT_POLICY_BLOCKED, WORKSPACE_INVALID_PATH } from '@ant-chat/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NativeToolService } from '../nativeToolService'
import { createPathPolicy } from '../pathPolicy'

describe('native tool service 行为', () => {
  let workspacePath: string
  let outsidePath: string

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-workspace-'))
    outsidePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-outside-'))
  })

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true })
    fs.rmSync(outsidePath, { recursive: true, force: true })
  })

  it('拒绝通过 symlink 访问工作区外文件', () => {
    fs.writeFileSync(path.join(outsidePath, 'secret.txt'), 'secret')
    fs.symlinkSync(outsidePath, path.join(workspacePath, 'outside-link'))

    expect(() => createPathPolicy(workspacePath).resolveExisting('outside-link/secret.txt')).toThrow(WORKSPACE_INVALID_PATH)
  })

  it('read_file/list_dir/write_file 只在工作区内工作', async () => {
    const service = new NativeToolService(workspacePath)
    await service.writeFile({ path: 'src/a.txt', content: 'line-1\nline-2\nline-3' })

    await expect(service.readFile({ path: 'src/a.txt', offset: 2, limit: 1 })).resolves.toMatchObject({
      ok: true,
      result: '[Showing lines 2-2 of 3]\n2\tline-2\n\n[1 more lines. Use offset=3 limit=1 to continue]',
    })
    await expect(service.listDir({ path: 'src' })).resolves.toMatchObject({
      ok: true,
      result: expect.stringContaining('[file] a.txt'),
      diagnostics: {
        data: {
          offset: 0,
          total: 1,
          hasMore: false,
          items: [{ name: 'a.txt', type: 'file' }],
        },
      },
    })
    await expect(service.writeFile({ path: path.join(outsidePath, 'x.txt'), content: 'x' })).rejects.toThrow(WORKSPACE_INVALID_PATH)
  })

  it('read_file 支持按行分页并返回续读提示', async () => {
    const service = new NativeToolService(workspacePath)
    await service.writeFile({ path: 'src/b.txt', content: 'a\nb\nc\nd' })

    await expect(service.readFile({ path: 'src/b.txt', offset: 2, limit: 2 })).resolves.toMatchObject({
      ok: true,
      result: '[Showing lines 2-3 of 4]\n2\tb\n3\tc\n\n[1 more lines. Use offset=4 limit=2 to continue]',
    })
  })

  it('read_file offset 越界时报错', async () => {
    const service = new NativeToolService(workspacePath)
    await service.writeFile({ path: 'src/c.txt', content: 'a\nb' })

    await expect(service.readFile({ path: 'src/c.txt', offset: 10, limit: 1 })).rejects.toThrow(
      'READ_FILE_OFFSET_OUT_OF_RANGE',
    )
  })

  it('edit_file 支持单文件多处精确替换并保留 CRLF', async () => {
    const service = new NativeToolService(workspacePath)
    fs.mkdirSync(path.join(workspacePath, 'src'))
    fs.writeFileSync(path.join(workspacePath, 'src/edit.ts'), 'const a = 1\r\nconst b = 2\r\nconst c = 3\r\n')

    await expect(service.editFile({
      path: 'src/edit.ts',
      edits: [
        { oldText: 'const a = 1\n', newText: 'const a = 10\n' },
        { oldText: 'const c = 3\n', newText: 'const c = 30\n' },
      ],
    })).resolves.toMatchObject({
      ok: true,
      result: expect.stringContaining('replacements=2'),
      diagnostics: { data: { path: 'src/edit.ts', replacements: 2 } },
    })

    expect(fs.readFileSync(path.join(workspacePath, 'src/edit.ts'), 'utf8')).toBe('const a = 10\r\nconst b = 2\r\nconst c = 30\r\n')
  })

  it('edit_file 拒绝非唯一和重叠替换', async () => {
    const service = new NativeToolService(workspacePath)
    fs.mkdirSync(path.join(workspacePath, 'src'))
    fs.writeFileSync(path.join(workspacePath, 'src/dup.ts'), 'same\nsame\n')
    fs.writeFileSync(path.join(workspacePath, 'src/overlap.ts'), 'abcdef\n')

    await expect(service.editFile({
      path: 'src/dup.ts',
      edits: [{ oldText: 'same\n', newText: 'next\n' }],
    })).rejects.toThrow('oldText 必须唯一')

    await expect(service.editFile({
      path: 'src/overlap.ts',
      edits: [
        { oldText: 'abc', newText: 'x' },
        { oldText: 'bcd', newText: 'y' },
      ],
    })).rejects.toThrow('重叠')

    expect(fs.readFileSync(path.join(workspacePath, 'src/dup.ts'), 'utf8')).toBe('same\nsame\n')
    expect(fs.readFileSync(path.join(workspacePath, 'src/overlap.ts'), 'utf8')).toBe('abcdef\n')
  })

  it('bash 阻断危险命令并允许低风险 mkdir', async () => {
    const service = new NativeToolService(workspacePath)
    const bash = service.getTools().find(tool => tool.name === 'bash')!

    await expect(bash.execute({ command: 'rm -rf src' })).resolves.toMatchObject({
      ok: false,
      result: expect.stringContaining('命令被安全策略拦截'),
    })

    await expect(bash.execute({ command: 'mkdir -p src/nested' })).resolves.toMatchObject({ ok: true })
    expect(fs.statSync(path.join(workspacePath, 'src/nested')).isDirectory()).toBe(true)
    await expect(bash.execute({ command: 'pwd && ls -la' })).resolves.toMatchObject({ ok: true })
  })

  it('bash schema 暴露可选 description 供界面展示命令用途，且不影响执行', async () => {
    const service = new NativeToolService(workspacePath)
    const bash = service.getTools().find(tool => tool.name === 'bash')!

    expect(bash.inputSchema?.properties).toHaveProperty('description')
    expect(bash.inputSchema?.required).toEqual(['command'])

    // description 仅用于展示，执行路径忽略该字段
    await expect(bash.execute({ command: 'pwd', description: '查看当前目录' })).resolves.toMatchObject({ ok: true })
  })

  it('将 Desktop 注入的 launcher PATH 传给 bash 子进程', async () => {
    const launcherPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-launcher-'))
    const launcher = path.join(launcherPath, 'ant-chat')
    fs.writeFileSync(launcher, '#!/bin/sh\nprintf launcher-ok\n')
    fs.chmodSync(launcher, 0o755)

    const service = new NativeToolService(workspacePath, true, {
      bashEnvironment: { PATH: launcherPath },
    })
    const bash = service.getTools().find(tool => tool.name === 'bash')!
    const result = await bash.execute({ command: 'ant-chat' })

    expect(result.ok).toBe(true)
    expect(result.diagnostics?.stdout).toContain('launcher-ok')
    fs.rmSync(launcherPath, { force: true, recursive: true })
  })

  it('bash 自己定义失败结果写入模型上下文的格式', async () => {
    const service = new NativeToolService(workspacePath)
    const bash = service.getTools().find(tool => tool.name === 'bash')!
    const result = await bash.execute({ command: 'ls missing.txt' })

    expect(result).toMatchObject({
      ok: false,
      result: expect.stringContaining('stderr:'),
      diagnostics: { exitCode: expect.any(Number) },
    })
    expect(result.diagnostics?.exitCode).toBeGreaterThan(0)
    expect(result.result).toContain('exitCode=')
  })

  it('将普通网页操作标记为外部资源，将系统 Profile 标记为本机越界资源', () => {
    const service = new NativeToolService(workspacePath, false, {
      browser: {
        profilePath: '/tmp/profile',
        artifactsPath: '/tmp/artifacts',
      },
    })
    const browser = service.getTools().find(tool => tool.name === 'browser')

    expect(browser).toMatchObject({
      name: 'browser',
      operationType: 'browser',
    })
    expect(browser?.inferScope({ command: 'open', args: ['https://example.com'] })).toBe('external')
    expect(browser?.inferScope({ command: 'open', args: ['--profile', 'Default', 'https://example.com'] })).toBe('outside')
  })

  it('注册 browser 工具后阻断 Bash 绕过调用 agent-browser', async () => {
    const service = new NativeToolService(workspacePath, true, {
      browser: {
        profilePath: '/tmp/profile',
        artifactsPath: '/tmp/artifacts',
      },
    })
    const bash = service.getTools().find(tool => tool.name === 'bash')!

    expect(bash.inferScope({ command: 'npx --yes agent-browser snapshot -i' })).toBe('blocked')
    await expect(bash.execute({ command: 'npx --yes agent-browser snapshot -i' })).resolves.toMatchObject({
      ok: false,
      result: expect.stringContaining('命令被安全策略拦截'),
    })
  })

  it('tool execute 遇到越界路径返回 AGENT_POLICY_BLOCKED', async () => {
    const service = new NativeToolService(workspacePath)
    const readFile = service.getTools().find(tool => tool.name === 'read_file')!
    const result = await readFile.execute({ path: path.join(outsidePath, 'secret.txt') })
    expect(result.ok).toBe(false)
    expect(result.result).toBe('工具执行失败：路径不在允许的工作区范围内。')
    expect(result.diagnostics?.data).toEqual({ code: AGENT_POLICY_BLOCKED })
  })

  describe('inferScope 行为', () => {
    it('read_file 工作区内 → workspace', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'read_file')!
      expect(tool.inferScope({ path: 'src/a.txt' })).toBe('workspace')
    })

    it('read_file 工作区外 → outside', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'read_file')!
      expect(tool.inferScope({ path: outsidePath })).toBe('outside')
    })

    it('glob_files 工作区内 → workspace', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'glob_files')!
      expect(tool.inferScope({ pattern: '*.ts' })).toBe('workspace')
    })

    it('glob_files 工作区外路径 → outside', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'glob_files')!
      expect(tool.inferScope({ pattern: '*.ts', path: outsidePath })).toBe('outside')
    })

    it('write_file 工作区内 → workspace', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'write_file')!
      expect(tool.inferScope({ path: 'src/new.txt', content: 'x' })).toBe('workspace')
    })

    it('write_file 工作区外 → outside', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'write_file')!
      expect(tool.inferScope({ path: path.join(outsidePath, 'x.txt'), content: 'x' })).toBe('outside')
    })

    it('edit_file 工作区内 → workspace', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'edit_file')!
      expect(tool.inferScope({ path: 'src/a.txt', edits: [{ oldText: 'a', newText: 'b' }] })).toBe('workspace')
    })

    it('bash find /Users → outside（路径逃逸，可审批）', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: 'find /Users/ysansan -name "*.pdf"' })).toBe('outside')
      expect(tool.inferScope({ command: 'find ~/Documents -name "*.pdf"' })).toBe('outside')
    })

    it('bash 安全命令工作区内 → workspace', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: 'ls' })).toBe('workspace')
      expect(tool.inferScope({ command: 'find . -name "*.ts"' })).toBe('workspace')
    })

    it('bash rm/sudo/curl → outside（需审批）', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: 'rm -rf src' })).toBe('outside')
      expect(tool.inferScope({ command: 'sudo ls' })).toBe('outside')
      expect(tool.inferScope({ command: 'curl http://example.com' })).toBe('outside')
    })

    it('bash 管道重定向 → outside（需审批）', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: 'ls | grep foo' })).toBe('outside')
      expect(tool.inferScope({ command: 'find . > /tmp/out' })).toBe('outside')
    })

    it('bash 工作区内的非只读命令保持 workspace（由授权层审批）', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: 'git status' })).toBe('workspace')
    })

    it('bash 空命令 → blocked', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: '' })).toBe('blocked')
    })
  })
})
