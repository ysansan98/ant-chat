import type { AvailableCommandHost } from '../types'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareBashCommand } from '../bashCommandAdapter'

const workspacePath = process.cwd()
const host: AvailableCommandHost = {
  status: 'available',
  platform: 'posix',
  adapter: 'bash',
  interpreter: 'bash',
  executablePath: '/fixed/bin/bash',
  environment: {
    HOME: os.homedir(),
    PATH: '/fixed/bin:/usr/bin',
    TMPDIR: '/tmp',
  },
}

describe('bash 命令适配器', () => {
  it('普通只读命令固定解释器、参数和工作目录', () => {
    const prepared = prepareBashCommand(
      { command: 'git status' },
      workspacePath,
      host,
    )

    expect(prepared).toMatchObject({
      kind: 'command',
      interpreter: 'bash',
      command: 'git status',
      cwd: workspacePath,
      resourceScope: 'workspace',
      isReadOnly: true,
      risk: 'ordinary',
      executionPlan: {
        executablePath: '/fixed/bin/bash',
        args: ['--noprofile', '--norc', '-c', 'git status'],
        cwd: workspacePath,
        environment: host.environment,
      },
    })
  })

  it.each([
    ['rm -rf ./dist'],
    ['curl https://example.com'],
    ['sudo git status'],
    ['pnpm install'],
  ])('%s 是可审批的高风险命令', (command) => {
    expect(prepareBashCommand({ command }, workspacePath, host)).toMatchObject({
      risk: 'requires_approval',
    })
  })

  it.each([
    ['rm -rf /'],
    ['rm -rf /*'],
    [`rm -rf ${os.homedir()}`],
    [`rm -rf ${path.join(os.homedir(), '*')}`],
    ['rm -rf ~'],
    [`rm -rf ${workspacePath}`],
    [`rm -rf ${path.dirname(workspacePath)}`],
    ['rm -rf /Volumes'],
    ['rm -rf /mnt'],
    ['rm -rf /media'],
    ['cd / && rm -rf .'],
  ])('%s 命中不可覆盖的底线保护', (command) => {
    const prepared = prepareBashCommand({ command }, workspacePath, host)

    expect(prepared.risk).toBe('bottomline_block')
    expect(prepared.riskReason).toBeTruthy()
  })

  it.each([
    '/srv/data',
    '/mnt/data',
    '/media/alice/usb',
    '/run/media/alice/usb',
  ])('删除真实挂载点 %s 命中底线保护', (mountPoint) => {
    const prepared = prepareBashCommand(
      { command: `rm -rf ${mountPoint}` },
      workspacePath,
      host,
      { isMountPoint: targetPath => targetPath === mountPoint },
    )

    expect(prepared.risk).toBe('bottomline_block')
  })

  it('可静态分析的 wrapper 不能绕过底线保护', () => {
    expect(prepareBashCommand(
      { command: 'sudo env SAFE=1 command rm -rf /' },
      workspacePath,
      host,
    )).toMatchObject({
      risk: 'bottomline_block',
    })
  })

  it.each([
    ['eval "rm -rf /"'],
    ['bash -c "rm -rf /"'],
    ['echo $(whoami)'],
  ])('%s 的执行对象无法静态确认时直接阻断', (command) => {
    expect(prepareBashCommand({ command }, workspacePath, host)).toMatchObject({
      risk: 'bottomline_block',
    })
  })
})
