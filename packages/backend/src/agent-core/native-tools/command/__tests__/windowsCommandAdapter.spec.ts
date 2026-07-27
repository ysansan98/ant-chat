import type { AvailableCommandHost } from '../types'
import { describe, expect, it } from 'vitest'
import { prepareWindowsCommand } from '../windowsCommandAdapter'

const workspacePath = String.raw`C:\work\repo`

function createHost(interpreter: 'powershell7' | 'windows-powershell' | 'cmd'): AvailableCommandHost {
  return {
    status: 'available',
    platform: 'windows',
    adapter: 'windows',
    interpreter,
    executablePath: interpreter === 'cmd'
      ? String.raw`C:\Windows\System32\cmd.exe`
      : interpreter === 'powershell7'
        ? String.raw`C:\Program Files\PowerShell\7\pwsh.exe`
        : String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
    environment: {
      'PATH': String.raw`C:\Windows\System32`,
      'SystemRoot': String.raw`C:\Windows`,
      'ProgramFiles': String.raw`C:\Program Files`,
      'ProgramFiles(x86)': String.raw`C:\Program Files (x86)`,
      'ProgramData': String.raw`C:\ProgramData`,
      'USERPROFILE': String.raw`C:\Users\Alice`,
      'TEMP': String.raw`C:\Users\Alice\AppData\Local\Temp`,
      'TMP': String.raw`C:\Users\Alice\AppData\Local\Temp`,
    },
  }
}

const identityBoundary = {
  realpath: (targetPath: string) => targetPath,
}

function preparePowerShell(command: string, interpreter: 'powershell7' | 'windows-powershell' = 'powershell7') {
  return prepareWindowsCommand(
    { command, description: '执行测试命令', cwd: workspacePath, timeoutMs: 1234 },
    workspacePath,
    createHost(interpreter),
    { fileSystem: identityBoundary },
  )
}

function prepareCmd(command: string) {
  return prepareWindowsCommand(
    { command, description: '执行测试命令', cwd: workspacePath, timeoutMs: 1234 },
    workspacePath,
    createHost('cmd'),
    { fileSystem: identityBoundary },
  )
}

describe('prepareWindowsCommand', () => {
  it.each([
    ['powershell7', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']],
    ['windows-powershell', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']],
    ['cmd', ['/d', '/s', '/c']],
  ] as const)('%s 固定启动期解释器、显式参数、工作目录和受控环境', (interpreter, prefix) => {
    const host = createHost(interpreter)
    const input = {
      command: interpreter === 'cmd' ? 'dir' : 'Get-ChildItem',
      description: '列出文件',
      cwd: workspacePath,
      timeoutMs: 1234,
    }

    const prepared = prepareWindowsCommand(input, workspacePath, host, { fileSystem: identityBoundary })

    expect(prepared.input).toEqual(input)
    expect(prepared.executionPlan).toEqual({
      executablePath: host.executablePath,
      args: [...prefix, input.command],
      cwd: workspacePath,
      environment: host.environment,
    })
    expect(prepared).toMatchObject({
      kind: 'command',
      interpreter,
      resourceScope: 'workspace',
      risk: 'ordinary',
    })
  })

  it('统一 input 原样保留 SecretRef，但执行计划环境只使用启动期受控环境', () => {
    const host = createHost('powershell7')
    const input = {
      command: 'Get-ChildItem',
      description: '列出文件',
      cwd: workspacePath,
      timeoutMs: 1234,
      secretEnv: {
        TOKEN: {
          kind: 'secret_ref' as const,
          id: 'turn:run-1:secret-1',
          scope: 'turn' as const,
        },
      },
    }

    const prepared = prepareWindowsCommand(input, workspacePath, host, { fileSystem: identityBoundary })

    expect(prepared.input).toEqual(input)
    expect(prepared.hasSecretEnv).toBe(true)
    expect(prepared.isReadOnly).toBe(false)
    expect(prepared.risk).toBe('requires_approval')
    expect(prepared.executionPlan.environment).toEqual(host.environment)
    expect(prepared.executionPlan.environment).not.toHaveProperty('TOKEN')
  })

  it.each([
    'Remove-Item -Recurse -Force .\\dist',
    'Remove-Item -LiteralPath ".\\dist" -Recurse -Force',
  ])('powerShell 删除工作区子目录只需要审批：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'requires_approval',
      resourceScope: 'workspace',
    })
  })

  it.each([
    'rmdir /s /q dist',
    'rd /s /q dist',
    'del /f /s /q dist\\*',
    'erase /f /s /q dist\\*',
  ])('cMD 删除工作区子目录只需要审批：%s', (command) => {
    expect(prepareCmd(command)).toMatchObject({
      risk: 'requires_approval',
      resourceScope: 'workspace',
    })
  })

  it.each([
    'Remove-Item -Recurse -Force C:\\',
    String.raw`Remove-Item -Recurse -Force c:/`,
    String.raw`Remove-Item -Recurse -Force C:\*`,
    String.raw`Remove-Item -Recurse -Force \\server\share`,
    String.raw`Remove-Item -Recurse -Force \\server\share\*`,
    'Remove-Item -Recurse -Force \\\\?\\C:\\',
    String.raw`Remove-Item -Recurse -Force \\?\UNC\server\share`,
    String.raw`Remove-Item -Recurse -Force \\.\PhysicalDrive0`,
    'Remove-Item -Recurse -Force \\\\?\\Volume{abc}\\',
    String.raw`Remove-Item -Recurse -Force C:\Users\Alice`,
    String.raw`Remove-Item -Recurse -Force C:\USERS\ALICE\*`,
    String.raw`Remove-Item -Recurse -Force C:\Windows`,
    String.raw`Remove-Item -Recurse -Force "C:\Program Files"`,
    String.raw`Remove-Item -Recurse -Force C:\ProgramData`,
    String.raw`Remove-Item -Recurse -Force C:\Users`,
    'Remove-Item -Recurse -Force $env:ProgramFiles',
    String.raw`Remove-Item -Recurse -Force C:\work`,
    String.raw`Remove-Item -Recurse -Force C:\work\repo`,
    'Remove-Item -Recurse -Force FileSystem::C:\\',
    String.raw`Remove-Item -Recurse -Force C:\**`,
    String.raw`Remove-Item -Recurse -Force C:\?*`,
  ])('powerShell 阻断受保护根及其全量内容表达式：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'bottomline_block',
      riskReason: expect.any(String),
    })
  })

  it.each([
    'rmdir /s /q C:\\',
    String.raw`rd /s /q c:/WORK`,
    String.raw`del /f /s /q \\server\share\*`,
    String.raw`erase /f /s /q \\?\C:\*`,
    String.raw`rmdir /s /q %USERPROFILE%`,
    String.raw`rmdir /s /q %SystemRoot%`,
    String.raw`rmdir /s /q C:\Users`,
  ])('cMD 阻断等价的受保护路径：%s', (command) => {
    expect(prepareCmd(command)).toMatchObject({
      risk: 'bottomline_block',
      riskReason: expect.any(String),
    })
  })

  it('cMD 按 cd /d 后的目录解析相对删除目标', () => {
    expect(prepareCmd(String.raw`cd /d C:\work && rmdir /s /q repo`)).toMatchObject({
      risk: 'bottomline_block',
    })
  })

  it('通过文件系统边界把 junction 和 8.3 短路径绑定到真实受保护路径', () => {
    const realpath = (targetPath: string) => {
      if (targetPath.toLowerCase() === String.raw`C:\link`.toLowerCase())
        return String.raw`C:\Users\Alice`
      if (targetPath.toLowerCase() === String.raw`C:\PROGRA~1`.toLowerCase())
        return String.raw`C:\Program Files`
      return targetPath
    }

    for (const command of [
      String.raw`Remove-Item -Recurse -Force C:\link`,
      String.raw`Remove-Item -Recurse -Force C:\PROGRA~1`,
    ]) {
      expect(prepareWindowsCommand(
        { command },
        workspacePath,
        createHost('powershell7'),
        { fileSystem: { realpath } },
      )).toMatchObject({ risk: 'bottomline_block' })
    }
  })

  it.each([
    'Remove-Item -Recurse -Force $target',
    ['Remove-Item -Recurse -Force', '$' + '{target}'].join(' '),
    'pwsh.exe -Command "Remove-Item -Recurse -Force C:\\work\\repo"',
    'powershell.exe -Command "Get-ChildItem"',
    'cmd.exe /c "rmdir /s /q C:\\work\\repo"',
    '.\\cleanup.ps1',
    '& .\\cleanup.ps1',
    'Invoke-Expression $command',
  ])('powerShell 无法证明执行对象时底线阻断：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({ risk: 'bottomline_block' })
  })

  it.each([
    'rmdir /s /q %TARGET%',
    'cmd.exe /c "rmdir /s /q C:\\work\\repo"',
    'powershell.exe -Command "Remove-Item C:\\work\\repo"',
    'cleanup.cmd',
    'cleanup.bat',
    'call cleanup.cmd',
  ])('cMD 无法证明执行对象时底线阻断：%s', (command) => {
    expect(prepareCmd(command)).toMatchObject({ risk: 'bottomline_block' })
  })

  it('环境变量展开后再执行大小写不敏感的底线比较', () => {
    expect(preparePowerShell('Remove-Item -Recurse -Force $env:USERPROFILE')).toMatchObject({
      risk: 'bottomline_block',
    })
    expect(prepareCmd('rmdir /s /q %userprofile%')).toMatchObject({
      risk: 'bottomline_block',
    })
  })

  it.each([
    'format C:',
    'format.com C:',
    'diskpart',
    'bcdedit /delete {current}',
    'bcdedit.exe /set {current} recoveryenabled no',
    'bootrec /fixmbr',
    'bootrec.exe /rebuildbcd',
    'bootsect /nt60 sys',
    'bootsect.exe /nt60 all',
  ])('直接磁盘或启动配置破坏一律底线阻断：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'bottomline_block',
      riskReason: expect.stringContaining('磁盘或启动配置'),
    })
    expect(prepareCmd(command)).toMatchObject({
      risk: 'bottomline_block',
      riskReason: expect.stringContaining('磁盘或启动配置'),
    })
  })

  it('powerShell 按引号外分号顺序分析每个静态命令段', () => {
    const prepared = preparePowerShell(String.raw`Get-Content ".\a;b.txt"; Remove-Item .\dist; Get-Item .\package.json`)

    expect(prepared).toMatchObject({
      risk: 'requires_approval',
      resourceScope: 'workspace',
      segments: [
        { executable: 'get-content', args: [String.raw`.\a;b.txt`], isReadOnly: true },
        { executable: 'remove-item', args: [String.raw`.\dist`], isReadOnly: false },
        { executable: 'get-item', args: [String.raw`.\package.json`], isReadOnly: true },
      ],
    })
  })

  it.each([
    String.raw`cd C:\; rm -Recurse Windows`,
    String.raw`Set-Location -LiteralPath C:\; Remove-Item -Recurse Windows`,
    String.raw`sl C:\; ri -Recurse Windows`,
  ])('powerShell 切换目录后按新 cwd 判定相对删除底线：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'bottomline_block',
      riskReason: expect.stringContaining(String.raw`C:\Windows`),
    })
  })

  it.each([
    String.raw`rm -Recurse C:\Windows`,
    String.raw`ri -Recurse C:\Windows`,
    String.raw`del -Recurse C:\Windows`,
    String.raw`erase -Recurse C:\Windows`,
    String.raw`rd -Recurse C:\Windows`,
    String.raw`rmdir -Recurse C:\Windows`,
  ])('powerShell Remove-Item 别名仍按删除目标分类：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'bottomline_block',
      riskReason: expect.stringContaining(String.raw`C:\Windows`),
    })
  })

  it.each([
    '; Get-Item .',
    'Get-Item .;',
    'Get-Item .;; Get-Content .\\package.json',
  ])('powerShell 拒绝包含空段的命令串：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'bottomline_block',
      riskReason: expect.stringContaining('无法可靠解析'),
    })
  })

  it.each([
    'Write-Output ok && Remove-Item -Recurse C:\\Windows',
    'Write-Output ok || Remove-Item -Recurse C:\\Windows',
    'Write-Output ok\nRemove-Item -Recurse C:\\Windows',
    'Write-Output ok\r\nRemove-Item -Recurse C:\\Windows',
    '&\'script.ps1\'',
    String.raw`Remove-Item C:\work\repo\dist,C:\Windows -Recurse`,
    String.raw`Get-Content .\ok,C:\outside\secret`,
    String.raw`Get-Content @(.\ok, C:\outside\secret)`,
  ])('powerShell 未建模的复合语法一律底线阻断：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'bottomline_block',
    })
  })

  it('powerShell 保留引号内逗号作为普通路径字符', () => {
    expect(preparePowerShell(String.raw`Get-Content ".\with,comma.txt"`)).toMatchObject({
      risk: 'ordinary',
      resourceScope: 'workspace',
      segments: [{ args: [String.raw`.\with,comma.txt`] }],
    })
  })

  it.each([
    String.raw`Copy-Item .\package.json C:\outside\package.json`,
    String.raw`Copy-Item -Path .\package.json -Destination C:\outside\package.json`,
    String.raw`Move-Item .\dist C:\outside\dist`,
    String.raw`Set-Content -Path C:\outside\result.txt -Value ok`,
    String.raw`New-Item -Path C:\outside\created -ItemType Directory`,
    String.raw`Set-Item -Path C:\outside\result.txt -Value ok`,
  ])('powerShell 写命令按静态目的路径判工作区外且需要审批：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'requires_approval',
      resourceScope: 'outside',
      segments: [{ resourceScope: 'outside', isReadOnly: false }],
    })
  })

  it.each([
    String.raw`copy /Y .\package.json C:\outside\package.json`,
    String.raw`move /Y .\dist C:\outside\dist`,
  ])('cMD 写命令按静态目的路径判工作区外且需要审批：%s', (command) => {
    expect(prepareCmd(command)).toMatchObject({
      risk: 'requires_approval',
      resourceScope: 'outside',
      segments: [{ resourceScope: 'outside', isReadOnly: false }],
    })
  })

  it.each([
    'Invoke-RestMethod https://example.com',
    'iwr https://example.com',
    'irm https://example.com',
    'wget https://example.com',
    'Start-BitsTransfer https://example.com .\\download',
    'ssh example.com',
    'scp .\\file example.com:/tmp/file',
  ])('powerShell 常见网络命令需要审批：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'requires_approval',
      isReadOnly: false,
    })
  })

  it.each([
    '$env:PATH = "C:\\tools"',
    '$env:TEMP="C:\\outside"',
    '$env:FOO=\'bar\'',
  ])('powerShell 静态环境变量赋值只允许单次审批：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'requires_approval',
      isReadOnly: false,
      segments: [{ executable: expect.stringContaining('$env:') }],
    })
  })

  it.each([
    '$env:FOO=$(Get-Content .\\secret)',
    '$env:FOO=Get-Content .\\secret',
  ])('powerShell 动态环境变量赋值底线阻断：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'bottomline_block',
      isReadOnly: false,
    })
  })

  it.each([
    'agent-browser snapshot -i',
    'npx --yes agent-browser get title',
    'npx --yes Agent-Browser get title',
    'pnpm exec agent-browser open https://example.com',
  ])('browser 工具受控时 Windows 命令不能绕过启动 agent-browser：%s', (command) => {
    const prepared = prepareWindowsCommand(
      { command, cwd: workspacePath },
      workspacePath,
      createHost('powershell7'),
      { fileSystem: identityBoundary, blockAgentBrowser: true },
    )

    expect(prepared).toMatchObject({
      risk: 'bottomline_block',
      riskReason: expect.stringContaining('agent-browser'),
    })
  })

  it('browser 工具未启用时 agent-browser 仍按普通命令风险分类', () => {
    expect(preparePowerShell('agent-browser snapshot -i')).toMatchObject({
      risk: 'ordinary',
    })
  })

  it.each([
    {
      command: String.raw`Get-Content .\SKILL.md`,
      cwd: String.raw`C:\skills\selected`,
    },
    {
      command: String.raw`Get-Content C:\skills\selected\SKILL.md`,
      cwd: workspacePath,
    },
  ])('selected trusted root 的 cwd 和静态路径均归入 workspace scope：$command', (input) => {
    const prepared = prepareWindowsCommand(
      input,
      workspacePath,
      createHost('powershell7'),
      {
        fileSystem: identityBoundary,
        trustedPaths: [String.raw`C:\skills\selected`],
      },
    )

    expect(prepared).toMatchObject({
      risk: 'ordinary',
      resourceScope: 'workspace',
      segments: [{ resourceScope: 'workspace' }],
    })
  })

  it('selected trusted root 不会授权相邻目录', () => {
    const prepared = prepareWindowsCommand(
      { command: String.raw`Get-Content C:\skills\other\SKILL.md`, cwd: workspacePath },
      workspacePath,
      createHost('powershell7'),
      {
        fileSystem: identityBoundary,
        trustedPaths: [String.raw`C:\skills\selected`],
      },
    )

    expect(prepared).toMatchObject({
      resourceScope: 'outside',
      segments: [{ resourceScope: 'outside' }],
    })
  })

  it.each([
    'echo ok\ndir C:\\outside',
    'echo ok\r\ndir C:\\outside',
  ])('cMD 未建模的换行命令串一律底线阻断：%s', (command) => {
    expect(prepareCmd(command)).toMatchObject({
      risk: 'bottomline_block',
    })
  })

  it.each([
    'Get-Content .\\package.json | Select-Object -First 1; Get-Item .',
    'Get-Item $(Resolve-Path .); Get-Content .\\package.json',
    'Get-Item .; Invoke-Expression $command',
  ])('powerShell 任一分段含动态结构时整次调用底线阻断：%s', (command) => {
    expect(preparePowerShell(command)).toMatchObject({
      risk: 'bottomline_block',
    })
  })

  it.each([
    ['Get-Content C:\\outside\\secret.txt', 'powershell7'],
    ['Get-Item -LiteralPath C:\\outside\\secret.txt', 'powershell7'],
    ['Get-Item -LiteralPath:C:\\outside\\secret.txt', 'powershell7'],
    ['Get-ChildItem -Path C:\\outside', 'powershell7'],
    ['type C:\\outside\\secret.txt', 'cmd'],
    ['dir C:\\outside', 'cmd'],
    ['where /r C:\\outside secret.txt', 'cmd'],
  ] as const)('%s 按静态路径参数把资源域判为工作区外', (command, interpreter) => {
    const prepared = interpreter === 'cmd' ? prepareCmd(command) : preparePowerShell(command)

    expect(prepared).toMatchObject({
      resourceScope: 'outside',
      segments: [{ resourceScope: 'outside', isReadOnly: true }],
    })
  })

  it.each([
    'where /r',
    'where /r C:\\outside',
    'where /r /q secret.txt',
    'where /r C:\\out* secret.txt',
  ])('cMD where /r 参数不完整或目录动态时底线阻断：%s', (command) => {
    expect(prepareCmd(command)).toMatchObject({
      risk: 'bottomline_block',
      riskReason: expect.stringContaining('where /r'),
    })
  })

  it.each([
    ['Get-Content .\\package.json', 'powershell7'],
    ['Get-Item -LiteralPath .\\package.json', 'powershell7'],
    ['Get-ChildItem -Path .\\src', 'powershell7'],
    ['type .\\package.json', 'cmd'],
    ['dir .\\src', 'cmd'],
  ] as const)('%s 按静态路径参数把资源域判为工作区内', (command, interpreter) => {
    const prepared = interpreter === 'cmd' ? prepareCmd(command) : preparePowerShell(command)

    expect(prepared).toMatchObject({
      resourceScope: 'workspace',
      segments: [{ resourceScope: 'workspace', isReadOnly: true }],
    })
  })

  it('静态读取路径通过文件系统边界解析 junction 后再判资源域', () => {
    const prepared = prepareWindowsCommand(
      { command: String.raw`Get-Content .\linked\secret.txt`, cwd: workspacePath },
      workspacePath,
      createHost('powershell7'),
      {
        fileSystem: {
          realpath: targetPath => targetPath.toLowerCase() === String.raw`C:\work\repo\linked\secret.txt`.toLowerCase()
            ? String.raw`C:\outside\secret.txt`
            : targetPath,
        },
      },
    )

    expect(prepared).toMatchObject({
      resourceScope: 'outside',
      segments: [{ resourceScope: 'outside' }],
    })
  })

  it('拒绝非 Windows adapter host', () => {
    const host: AvailableCommandHost = {
      ...createHost('powershell7'),
      platform: 'posix',
      adapter: 'bash',
      interpreter: 'bash',
      executablePath: '/bin/bash',
    }

    expect(() => prepareWindowsCommand({ command: 'Get-ChildItem' }, workspacePath, host))
      .toThrow('Windows Command Host')
  })
})
