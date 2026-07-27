import { describe, expect, it, vi } from 'vitest'
import { detectCommandHost } from '../commandHost'

function createFileSystem(availablePaths: string[]) {
  const available = new Set(availablePaths.map(path => path.toLowerCase()))
  return {
    isExecutable: vi.fn((path: string) => available.has(path.toLowerCase())),
    realpath: vi.fn((path: string) => path),
  }
}

describe('命令宿主探测', () => {
  it('单个候选的文件系统检查异常不会中断探测', () => {
    const host = detectCommandHost({
      platform: 'linux',
      environment: { PATH: '/broken:/usr/bin' },
      fileSystem: {
        isExecutable: vi.fn((candidate: string) => candidate === '/broken/bash'),
        realpath: vi.fn(() => {
          throw new Error('broken link')
        }),
      },
    })

    expect(host).toEqual(expect.objectContaining({
      status: 'unavailable',
      platform: 'posix',
    }))
  })

  it('pOSIX 启动时固定 Bash 绝对路径和受控环境', () => {
    const fileSystem = createFileSystem(['/custom/bin/bash'])

    const host = detectCommandHost({
      platform: 'darwin',
      environment: {
        HOME: '/Users/tester',
        PATH: '/custom/bin:/usr/bin',
        TMPDIR: '/tmp/tester',
        TOKEN: '不得进入受控环境',
      },
      fileSystem,
    })

    expect(host).toEqual({
      status: 'available',
      platform: 'posix',
      adapter: 'bash',
      interpreter: 'bash',
      executablePath: '/custom/bin/bash',
      environment: {
        HOME: '/Users/tester',
        PATH: '/custom/bin:/usr/bin',
        TMPDIR: '/tmp/tester',
      },
    })
  })

  it('windows 严格按 PowerShell 7、Windows PowerShell、CMD 选择解释器', () => {
    const fileSystem = createFileSystem([
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\cmd.exe',
    ])
    const environment = {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATH: 'C:\\Tools',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      ProgramFiles: 'C:\\Program Files',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      TMP: 'C:\\Temp',
      USERPROFILE: 'C:\\Users\\tester',
    }

    const host = detectCommandHost({
      platform: 'win32',
      environment,
      fileSystem,
    })

    expect(host).toMatchObject({
      status: 'available',
      platform: 'windows',
      adapter: 'windows',
      interpreter: 'powershell7',
      executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    })
    expect(host.status === 'available' && host.environment).toEqual({
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATH: 'C:\\Tools',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      ProgramFiles: 'C:\\Program Files',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      TMP: 'C:\\Temp',
      USERPROFILE: 'C:\\Users\\tester',
    })
  })

  it('windows 按大小写不敏感语义读取环境并输出规范键', () => {
    const fileSystem = createFileSystem([
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    ])

    const host = detectCommandHost({
      platform: 'win32',
      environment: {
        'path': 'C:\\Tools',
        'pathext': '.COM;.EXE;.BAT;.CMD',
        'systemroot': 'C:\\Windows',
        'comspec': 'C:\\Windows\\System32\\cmd.exe',
        'userprofile': 'C:\\Users\\tester',
        'temp': 'C:\\Temp',
        'tmp': 'C:\\Tmp',
        'programfiles': 'C:\\Program Files',
        'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
        'programdata': 'C:\\ProgramData',
        'TOKEN': '不得进入受控环境',
      },
      fileSystem,
    })

    expect(host).toEqual({
      status: 'available',
      platform: 'windows',
      adapter: 'windows',
      interpreter: 'powershell7',
      executablePath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      environment: {
        'PATH': 'C:\\Tools',
        'PATHEXT': '.COM;.EXE;.BAT;.CMD',
        'SystemRoot': 'C:\\Windows',
        'ComSpec': 'C:\\Windows\\System32\\cmd.exe',
        'USERPROFILE': 'C:\\Users\\tester',
        'TEMP': 'C:\\Temp',
        'TMP': 'C:\\Tmp',
        'ProgramFiles': 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        'ProgramData': 'C:\\ProgramData',
      },
    })
  })

  it('windows 缺少 PowerShell 7 时回退到 Windows PowerShell', () => {
    const fileSystem = createFileSystem([
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Windows\\System32\\cmd.exe',
    ])

    const host = detectCommandHost({
      platform: 'win32',
      environment: {
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        PATH: '',
        PATHEXT: '.EXE',
        SystemRoot: 'C:\\Windows',
      },
      fileSystem,
    })

    expect(host).toMatchObject({
      status: 'available',
      interpreter: 'windows-powershell',
      executablePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    })
  })

  it('windows 缺少 PowerShell 时回退到 CMD', () => {
    const fileSystem = createFileSystem(['C:\\Windows\\System32\\cmd.exe'])

    const host = detectCommandHost({
      platform: 'win32',
      environment: {
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        PATH: '',
        PATHEXT: '.EXE',
        SystemRoot: 'C:\\Windows',
      },
      fileSystem,
    })

    expect(host).toMatchObject({
      status: 'available',
      interpreter: 'cmd',
      executablePath: 'C:\\Windows\\System32\\cmd.exe',
    })
  })

  it('所有候选不可用时返回可行动的不可用状态', () => {
    const host = detectCommandHost({
      platform: 'linux',
      environment: { HOME: '/home/tester', PATH: '/missing' },
      fileSystem: createFileSystem([]),
    })

    expect(host).toMatchObject({
      status: 'unavailable',
      platform: 'posix',
      reason: '未找到可执行的 Bash，请安装 Bash 或检查 PATH。',
    })
    expect(host.status === 'unavailable' ? host.candidates : []).toEqual(['/missing/bash', '/bin/bash', '/usr/bin/bash'])
  })
})
