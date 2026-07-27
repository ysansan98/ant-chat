import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CommandToolInput } from '@ant-chat/shared'
import { rebuildRulesFromApproval } from '../../../policy/approvalRuleRebuilder'
import { prepareBashCommand } from '../../command/bashCommandAdapter'
import { createBashCandidates, matchBashRule, parseBashCommand } from '../bashCommandParser'

function preValidateBashScope(
  input: CommandToolInput,
  workspacePath: string,
  options: { executableSearchPath?: string, trustedPaths?: string[], blockAgentBrowser?: boolean } = {},
) {
  const parsed = parseBashCommand(input, workspacePath, options)
  return parsed.isBlocked ? 'blocked' : parsed.resourceScope
}

function isReadOnlyBashCommand(command: string, workspacePath: string): boolean {
  return parseBashCommand({ command }, workspacePath).isReadOnly
}

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

  describe('blocked — 直接拦截（底线命令或无效输入）', () => {
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

    it('动态 shell 结构不能绕过底线阻断', () => {
      expect(preValidateBashScope({ command: 'echo $(rm -rf /tmp/outside)' }, workspacePath)).toBe('blocked')
      expect(preValidateBashScope({ command: 'printf x & rm -rf ./target' }, workspacePath)).toBe('blocked')
    })

    it.each([
      'rm -rf src',
      'sudo ls',
      'curl http://example.com',
      'npm i package',
      'npm ci',
      'pnpm add package',
      'pnpm i',
      'yarn add package',
      'yarn',
      'pip3 install package',
    ])('高风险但非底线命令进入审批风险: %s', (command) => {
      const prepared = prepareBashCommand(
        { command },
        workspacePath,
        {
          status: 'available',
          platform: 'posix',
          adapter: 'bash',
          interpreter: 'bash',
          executablePath: '/bin/bash',
          environment: { PATH: process.env.PATH ?? '', HOME: os.homedir() },
        },
      )

      expect(prepared.risk).toBe('requires_approval')
    })
  })

  describe('outside — 需用户审批', () => {
    it.each([
      'pwd | cat',
      'echo content > output.txt',
      'cat < input.txt',
      'false || echo fallback',
      'echo one; echo two',
      'echo one\necho two',
    ])('复杂 shell 语法进入单次审批: %s', (command) => {
      const parsed = parseBashCommand({ command }, workspacePath)

      expect(parsed).toMatchObject({ isBlocked: false, hasShellSyntax: true, resourceScope: 'outside', isReadOnly: false })
      expect(preValidateBashScope({ command }, workspacePath)).toBe('outside')
    })

    it.each([
      'echo $(pwd)',
      'echo `pwd`',
      '(rm -rf ./target)',
      '{ rm -rf ./target; }',
      'if true; then rm -rf ./target; fi',
      String.raw`r\m -rf ./target`,
      'r""m -rf ./target',
      '! rm -rf ./target',
      'echo "$(rm -rf ./target)"',
      'echo "`rm -rf ./target`"',
      '$TOOL -rf ./target',
      '/bin/r? -rf ./target',
      '/bin/r[m] -rf ./target',
    ])('无法可靠抽取命令身份的 shell 结构直接阻断：%s', (command) => {
      expect(parseBashCommand({ command }, workspacePath)).toMatchObject({
        isBlocked: true,
        hasShellSyntax: true,
      })
    })

    it.each([
      '&& git status',
      'git status &&',
      'git status && && git log',
    ])('非法 && 不会被静默改写：%s', (command) => {
      expect(parseBashCommand({ command }, workspacePath)).toMatchObject({
        isBlocked: true,
        segments: [],
      })
    })

    it.each([
      'NODE_OPTIONS=--require=/tmp/hook.js node --version',
      'SAFE=1 rm -rf target',
      'git status && TOKEN=plain node --version',
    ])('拒绝在命令文本中内联普通环境变量：%s', (command) => {
      expect(parseBashCommand({ command }, workspacePath)).toMatchObject({
        isBlocked: true,
        blockReason: expect.stringContaining('secretEnv'),
      })
    })

    it.each([
      'env TOKEN=plain node --version',
      'command env TOKEN=plain node --version',
      'bash -c "TOKEN=plain node --version"',
    ])('拒绝通过包装命令重新引入通用环境通道：%s', (command) => {
      expect(parseBashCommand({ command }, workspacePath).isBlocked).toBe(true)
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

    it('option value 中的工作区外可见路径仍判定为 outside', () => {
      expect(preValidateBashScope(
        { command: 'node --require=/tmp/outside-hook.js app.js' },
        workspacePath,
      )).toBe('outside')
    })

    it('cwd 在工作区外', () => {
      expect(preValidateBashScope({ command: 'ls', cwd: '/Users/ysansan' }, workspacePath)).toBe('outside')
    })
  })

  describe('workspace — 安全放行', () => {
    it('记忆授权默认生成精确命令规则', () => {
      const parsed = parseBashCommand(
        { command: `${process.execPath} run.js issue` },
        workspacePath,
      )
      const candidates = createBashCandidates(parsed)
      const rules = rebuildRulesFromApproval(
        { candidates, context: { command: { segments: parsed.segments } } },
        { selections: [{ candidateIndex: 0 }], scope: 'workspace' },
      )

      expect(candidates).toEqual([
        expect.objectContaining({
          argvPrefix: ['run.js', 'issue'],
        }),
      ])
      expect(rules).toEqual([
        expect.objectContaining({
          argvPrefix: ['run.js', 'issue'],
          allowRemainingArgs: false,
        }),
      ])
      const rule = rules[0]
      if (!rule || rule.kind !== 'command') {
        throw new Error('缺少命令精确规则')
      }

      expect(matchBashRule(parsed, rule)).toBe(true)
      expect(matchBashRule(parseBashCommand(
        { command: `${process.execPath} run.js issue extra` },
        workspacePath,
      ), rule)).toBe(false)
      expect(matchBashRule(parseBashCommand(
        { command: `${process.execPath} run.js` },
        workspacePath,
      ), rule)).toBe(false)
    })

    it('通过 PATH 调用的命令只按命令名匹配，指向其他可执行文件后不重新审批', () => {
      const binPath = path.join(workspacePath, 'bin')
      const firstRuntimePath = path.join(binPath, 'nub-v1')
      const secondRuntimePath = path.join(binPath, 'nub-v2')
      const nodeShimPath = path.join(binPath, 'node')
      fs.mkdirSync(binPath)
      fs.writeFileSync(firstRuntimePath, '#!/bin/sh\n', { mode: 0o755 })
      fs.writeFileSync(secondRuntimePath, '#!/bin/sh\n', { mode: 0o755 })
      fs.symlinkSync(firstRuntimePath, nodeShimPath)
      const parsed = parseBashCommand(
        { command: 'node run.js' },
        workspacePath,
        { executableSearchPath: binPath },
      )
      const candidates = createBashCandidates(parsed)
      const rules = rebuildRulesFromApproval(
        { candidates, context: { command: { segments: parsed.segments } } },
        { selections: [{ candidateIndex: 0 }], scope: 'workspace' },
      )

      expect(candidates[0]).toEqual(expect.objectContaining({
        executable: 'node',
      }))
      expect(rules[0]).toEqual(expect.objectContaining({
        executable: 'node',
      }))
      expect(candidates[0]).not.toHaveProperty('executablePath')
      expect(rules[0]).not.toHaveProperty('executablePath')

      fs.rmSync(nodeShimPath)
      fs.symlinkSync(secondRuntimePath, nodeShimPath)
      const sameCommandWithDifferentPathTarget = parseBashCommand(
        { command: 'node run.js' },
        workspacePath,
        { executableSearchPath: binPath },
      )
      const rule = rules[0]
      if (!rule || rule.kind !== 'command')
        throw new Error('缺少命令规则')
      expect(matchBashRule(sameCommandWithDifferentPathTarget, rule)).toBe(true)
    })

    it('相对可执行路径按用户写出的命令文本匹配', () => {
      const executablePath = path.join(workspacePath, 'tool')
      fs.writeFileSync(executablePath, '#!/bin/sh\n', { mode: 0o755 })

      const candidate = createBashCandidates(parseBashCommand(
        { command: './tool status' },
        workspacePath,
      ))[0]

      expect(candidate).toEqual(expect.objectContaining({
        executable: './tool',
      }))
      expect(candidate).not.toHaveProperty('executablePath')
    })

    it('绝对路径命令按用户输入的字符串匹配，不解析 realpath', () => {
      const firstExecutable = path.join(workspacePath, 'tool-v1')
      const secondExecutable = path.join(workspacePath, 'tool-v2')
      fs.writeFileSync(firstExecutable, '#!/bin/sh\n', { mode: 0o755 })
      fs.writeFileSync(secondExecutable, '#!/bin/sh\n', { mode: 0o755 })
      const parsed = parseBashCommand({ command: `${firstExecutable} status` }, workspacePath)
      const rules = rebuildRulesFromApproval(
        { candidates: createBashCandidates(parsed), context: { command: { segments: parsed.segments } } },
        { selections: [{ candidateIndex: 0 }], scope: 'workspace' },
      )
      const rule = rules[0]
      if (!rule || rule.kind !== 'command')
        throw new Error('缺少命令绝对路径规则')

      // 规则保存用户输入的原始字符串，不解析 realpath
      expect(rule.executable).toBe(firstExecutable)
      expect(matchBashRule(parsed, rule)).toBe(true)
      // 不同绝对路径字符串不互通
      expect(matchBashRule(
        parseBashCommand({ command: `${secondExecutable} status` }, workspacePath),
        rule,
      )).toBe(false)
    })

    it('环境探测命令判定为只读且留在工作区范围', () => {
      const command = 'which node && node --version'

      expect(isReadOnlyBashCommand(command, workspacePath)).toBe(true)
      expect(preValidateBashScope({ command }, workspacePath)).toBe('workspace')
    })

    it('node 的版本参数不能夹带脚本执行', () => {
      expect(isReadOnlyBashCommand('node --version', workspacePath)).toBe(true)
      expect(isReadOnlyBashCommand('node -v --run build', workspacePath)).toBe(false)
      expect(preValidateBashScope({ command: 'node -v --run build' }, workspacePath)).toBe('workspace')
    })

    it('只读分类不会放行会启动子进程或写入文件的搜索参数', () => {
      expect(isReadOnlyBashCommand('rg --pre formatter query', workspacePath)).toBe(false)
      expect(isReadOnlyBashCommand('find . -exec rm {} \\;', workspacePath)).toBe(false)
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

    it('mkdir 缺少 -p 但目标在工作区内', () => {
      expect(preValidateBashScope({ command: 'mkdir src' }, workspacePath)).toBe('workspace')
    })

    it('cd 只改变后续段的 canonical cwd 与资源边界', () => {
      const parsed = parseBashCommand(
        { command: `pwd && cd ${skillPath} && pwd` },
        workspacePath,
      )

      expect(parsed.resourceScope).toBe('outside')
      expect(parsed.segments.map(segment => ({ cwd: segment.cwd, resourceScope: segment.resourceScope }))).toEqual([
        { cwd: fs.realpathSync.native(workspacePath), resourceScope: 'workspace' },
        { cwd: fs.realpathSync.native(skillPath), resourceScope: 'outside' },
        { cwd: fs.realpathSync.native(skillPath), resourceScope: 'outside' },
      ])
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
  })
})
