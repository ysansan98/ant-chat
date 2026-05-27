import { describe, expect, it } from 'vitest'
import { extractInputKey, generatePattern, isWhitelisted, matchPattern } from '../toolApprovalWhitelist'

describe('extractInputKey', () => {
  it('extracts command from bash input', () => {
    expect(extractInputKey('bash', { command: 'git log --oneline' })).toBe('git log --oneline')
    expect(extractInputKey('bash', {})).toBe('')
  })

  it('extracts path from file tool input', () => {
    expect(extractInputKey('write_file', { path: '/home/user/project/src/index.ts', content: 'hello' }))
      .toBe('/home/user/project/src/index.ts')
    expect(extractInputKey('read_file', { path: '/tmp/test.txt' })).toBe('/tmp/test.txt')
    expect(extractInputKey('edit_file', { path: '/a/b/c.ts' })).toBe('/a/b/c.ts')
  })

  it('extracts name from skill tool input', () => {
    expect(extractInputKey('use_skill', { name: 'my-skill' })).toBe('my-skill')
  })

  it('returns empty string for unknown tools', () => {
    expect(extractInputKey('unknown_tool', {})).toBe('')
  })
})

describe('matchPattern', () => {
  it('matches exact string', () => {
    expect(matchPattern('git status', 'git status')).toBe(true)
    expect(matchPattern('git status', 'git diff')).toBe(false)
  })

  it('matches single-segment wildcard', () => {
    expect(matchPattern('git *', 'git status')).toBe(true)
    expect(matchPattern('git *', 'git log')).toBe(true)
    // * matches any characters except /
    expect(matchPattern('git *', 'git log --oneline')).toBe(true)
    expect(matchPattern('git *', 'git/status')).toBe(false)
  })

  it('matches multi-segment wildcard', () => {
    expect(matchPattern('./src/**', './src/components/Button.tsx')).toBe(true)
    expect(matchPattern('./src/**', './src/a/b/c/d.ts')).toBe(true)
    expect(matchPattern('./src/**', './lib/utils.ts')).toBe(false)
  })

  it('matches bash command with path arguments via **', () => {
    expect(matchPattern('python3 **', 'python3 /path/to/script.py')).toBe(true)
    expect(matchPattern('python3 **', 'python3 -m pip install')).toBe(true)
    expect(matchPattern('python3 **', 'python3 --version')).toBe(true)
    // * (single-segment) matches args without /, but fails on paths containing /
    expect(matchPattern('python3 *', 'python3 -m pip install')).toBe(true)
    expect(matchPattern('python3 *', 'python3 /path/to/script.py')).toBe(false)
  })

  it('matches multi-line bash commands with **', () => {
    expect(matchPattern('python3 **', 'python3 -c "\nprint(1)\nprint(2)\n"')).toBe(true)
  })

  it('matches mixed wildcards', () => {
    expect(matchPattern('*/**', 'src/components/Button.tsx')).toBe(true)
    expect(matchPattern('./**/*.ts', './src/utils.ts')).toBe(true)
    expect(matchPattern('./**/*.ts', './src/utils.tsx')).toBe(false)
  })
})

describe('generatePattern', () => {
  it('generates bash pattern with first word', () => {
    expect(generatePattern('bash', { command: 'git log --oneline' }, 'workspace')).toBe('git **')
  })

  it('generates bash pattern with single command', () => {
    expect(generatePattern('bash', { command: 'pwd' }, 'workspace')).toBe('pwd **')
  })

  it('generates workspace-relative file pattern', () => {
    expect(generatePattern('write_file', { path: '/ws/src/components/Button.tsx' }, 'workspace', '/ws'))
      .toBe('./src/components/**')
  })

  it('generates root-relative file pattern', () => {
    expect(generatePattern('write_file', { path: '/ws/root.tsx' }, 'workspace', '/ws')).toBe('./**')
  })

  it('generates absolute file pattern for outside scope', () => {
    expect(generatePattern('write_file', { path: '/usr/local/bin/script' }, 'outside'))
      .toBe('/usr/local/bin/**')
  })

  it('generates skill pattern', () => {
    expect(generatePattern('use_skill', { name: 'my-skill' }, 'workspace')).toBe('my-skill')
  })
})

describe('isWhitelisted', () => {
  const baseEntry = {
    toolName: 'bash',
    toolScope: 'workspace' as const,
    pattern: 'git *',
  }

  it('finds matching global entry', () => {
    const result = isWhitelisted([baseEntry], 'bash', 'workspace', 'git status')
    expect(result).toBeDefined()
    expect(result!.pattern).toBe('git *')
  })

  it('returns undefined when toolName differs', () => {
    const result = isWhitelisted([baseEntry], 'write_file', 'workspace', 'git status')
    expect(result).toBeUndefined()
  })

  it('returns undefined when toolScope differs', () => {
    const result = isWhitelisted([baseEntry], 'bash', 'outside', 'git status')
    expect(result).toBeUndefined()
  })

  it('returns undefined when pattern does not match', () => {
    const result = isWhitelisted([baseEntry], 'bash', 'workspace', 'npm test')
    expect(result).toBeUndefined()
  })

  it('filters workspace entry by currentWorkspace', () => {
    const wsEntry = { ...baseEntry, workspacePath: '/ws-a' }
    expect(isWhitelisted([wsEntry], 'bash', 'workspace', 'git status', '/ws-a')).toBeDefined()
    expect(isWhitelisted([wsEntry], 'bash', 'workspace', 'git status', '/ws-b')).toBeUndefined()
    expect(isWhitelisted([wsEntry], 'bash', 'workspace', 'git status')).toBeUndefined()
  })

  it('returns undefined for empty entries', () => {
    expect(isWhitelisted([], 'bash', 'workspace', 'ls')).toBeUndefined()
  })

  it('matches file tool with path prefix', () => {
    const entry = {
      ...baseEntry,
      toolName: 'write_file',
      pattern: './src/**',
    }
    const result = isWhitelisted([entry], 'write_file', 'workspace', './src/components/Button.tsx')
    expect(result).toBeDefined()
  })

  it('normalizes absolute workspace path to relative before matching', () => {
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
