import { describe, expect, it } from 'vitest'
import { extractInputKey, generatePattern, isWhitelisted, matchPattern } from '../toolApprovalWhitelist'

describe('extractInputKey 行为', () => {
  it('从 bash 输入提取 command', () => {
    expect(extractInputKey('bash', { command: 'git log --oneline' })).toBe('git log --oneline')
    expect(extractInputKey('bash', {})).toBe('')
  })

  it('从文件工具输入提取 path', () => {
    expect(extractInputKey('write_file', { path: '/home/user/project/src/index.ts', content: 'hello' }))
      .toBe('/home/user/project/src/index.ts')
    expect(extractInputKey('read_file', { path: '/tmp/test.txt' })).toBe('/tmp/test.txt')
    expect(extractInputKey('edit_file', { path: '/a/b/c.ts' })).toBe('/a/b/c.ts')
  })

  it('从 skill 工具输入提取 name', () => {
    expect(extractInputKey('use_skill', { name: 'my-skill' })).toBe('my-skill')
  })

  it('未知工具返回空字符串', () => {
    expect(extractInputKey('unknown_tool', {})).toBe('')
  })
})

describe('matchPattern 行为', () => {
  it('匹配精确字符串', () => {
    expect(matchPattern('git status', 'git status')).toBe(true)
    expect(matchPattern('git status', 'git diff')).toBe(false)
  })

  it('匹配单段通配符', () => {
    expect(matchPattern('git *', 'git status')).toBe(true)
    expect(matchPattern('git *', 'git log')).toBe(true)
    // * matches any characters except /
    expect(matchPattern('git *', 'git log --oneline')).toBe(true)
    expect(matchPattern('git *', 'git/status')).toBe(false)
  })

  it('匹配多段通配符', () => {
    expect(matchPattern('./src/**', './src/components/Button.tsx')).toBe(true)
    expect(matchPattern('./src/**', './src/a/b/c/d.ts')).toBe(true)
    expect(matchPattern('./src/**', './lib/utils.ts')).toBe(false)
  })

  it('用 ** 匹配带路径参数的 bash 命令', () => {
    expect(matchPattern('python3 **', 'python3 /path/to/script.py')).toBe(true)
    expect(matchPattern('python3 **', 'python3 -m pip install')).toBe(true)
    expect(matchPattern('python3 **', 'python3 --version')).toBe(true)
    // * (single-segment) matches args without /, but fails on paths containing /
    expect(matchPattern('python3 *', 'python3 -m pip install')).toBe(true)
    expect(matchPattern('python3 *', 'python3 /path/to/script.py')).toBe(false)
  })

  it('用 ** 匹配多行 bash 命令', () => {
    expect(matchPattern('python3 **', 'python3 -c "\nprint(1)\nprint(2)\n"')).toBe(true)
  })

  it('匹配混合通配符', () => {
    expect(matchPattern('*/**', 'src/components/Button.tsx')).toBe(true)
    expect(matchPattern('./**/*.ts', './src/utils.ts')).toBe(true)
    expect(matchPattern('./**/*.ts', './src/utils.tsx')).toBe(false)
  })
})

describe('generatePattern 行为', () => {
  it('用首个词生成 bash pattern', () => {
    expect(generatePattern('bash', { command: 'git log --oneline' }, 'workspace')).toBe('git **')
  })

  it('用单条命令生成 bash pattern', () => {
    expect(generatePattern('bash', { command: 'pwd' }, 'workspace')).toBe('pwd **')
  })

  it('生成 workspace 相对文件 pattern', () => {
    expect(generatePattern('write_file', { path: '/ws/src/components/Button.tsx' }, 'workspace', '/ws'))
      .toBe('./src/components/**')
  })

  it('生成根目录相对文件 pattern', () => {
    expect(generatePattern('write_file', { path: '/ws/root.tsx' }, 'workspace', '/ws')).toBe('./**')
  })

  it('为 outside scope 生成绝对文件 pattern', () => {
    expect(generatePattern('write_file', { path: '/usr/local/bin/script' }, 'outside'))
      .toBe('/usr/local/bin/**')
  })

  it('生成 skill pattern', () => {
    expect(generatePattern('use_skill', { name: 'my-skill' }, 'workspace')).toBe('my-skill')
  })
})

describe('isWhitelisted 行为', () => {
  const baseEntry = {
    toolName: 'bash',
    toolScope: 'workspace' as const,
    pattern: 'git *',
  }

  it('找到匹配的全局 entry', () => {
    const result = isWhitelisted([baseEntry], 'bash', 'workspace', 'git status')
    expect(result).toBeDefined()
    expect(result!.pattern).toBe('git *')
  })

  it('toolName 不同时返回 undefined', () => {
    const result = isWhitelisted([baseEntry], 'write_file', 'workspace', 'git status')
    expect(result).toBeUndefined()
  })

  it('toolScope 不同时返回 undefined', () => {
    const result = isWhitelisted([baseEntry], 'bash', 'outside', 'git status')
    expect(result).toBeUndefined()
  })

  it('pattern 不匹配时返回 undefined', () => {
    const result = isWhitelisted([baseEntry], 'bash', 'workspace', 'npm test')
    expect(result).toBeUndefined()
  })

  it('按 currentWorkspace 过滤 workspace entry', () => {
    const wsEntry = { ...baseEntry, workspacePath: '/ws-a' }
    expect(isWhitelisted([wsEntry], 'bash', 'workspace', 'git status', '/ws-a')).toBeDefined()
    expect(isWhitelisted([wsEntry], 'bash', 'workspace', 'git status', '/ws-b')).toBeUndefined()
    expect(isWhitelisted([wsEntry], 'bash', 'workspace', 'git status')).toBeUndefined()
  })

  it('entries 为空时返回 undefined', () => {
    expect(isWhitelisted([], 'bash', 'workspace', 'ls')).toBeUndefined()
  })

  it('用路径前缀匹配文件工具', () => {
    const entry = {
      ...baseEntry,
      toolName: 'write_file',
      pattern: './src/**',
    }
    const result = isWhitelisted([entry], 'write_file', 'workspace', './src/components/Button.tsx')
    expect(result).toBeDefined()
  })

  it('匹配前将 workspace 绝对路径规范化为相对路径', () => {
    const entry = {
      ...baseEntry,
      toolName: 'write_file',
      pattern: './src/**',
    }
    const result = isWhitelisted(
      [entry],
      'write_file',
      'workspace',
      '/workspace/src/components/Button.tsx',
      '/workspace',
    )
    expect(result).toBeDefined()
  })
})
