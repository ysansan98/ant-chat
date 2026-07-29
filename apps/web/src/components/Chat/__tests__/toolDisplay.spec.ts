import type { ToolCallContent } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import {
  buildCommandSessionText,
  buildEditDiff,
  getCommandLanguage,
  getEditStats,
  getLanguageFromPath,
  getToolCategory,
  getToolLabel,
  parseCommandResult,
  splitToolName,
} from '../toolDisplay'

function toolCall(toolName: string, args: Record<string, unknown> = {}, serverName?: string): ToolCallContent {
  return { type: 'tool-call', toolCallId: 'call-1', toolName, args, serverName }
}

describe('getToolLabel 内置工具文案', () => {
  it('文件类工具展示操作与路径', () => {
    expect(getToolLabel(toolCall('read_file', { path: 'src/a.ts' })).primary).toBe('读取 src/a.ts')
    expect(getToolLabel(toolCall('write_file', { path: 'src/a.ts' })).primary).toBe('写入 src/a.ts')
    expect(getToolLabel(toolCall('list_dir', { path: 'src' })).primary).toBe('列出 src')
  })

  it('list_dir 缺省 path 时展示当前目录', () => {
    expect(getToolLabel(toolCall('list_dir', {})).primary).toBe('列出 .')
  })

  it('搜索类工具展示 pattern', () => {
    expect(getToolLabel(toolCall('grep_files', { pattern: 'foo' })).primary).toBe('搜索 foo')
    expect(getToolLabel(toolCall('glob_files', { pattern: '**/*.ts' })).primary).toBe('查找 **/*.ts')
  })

  it('命令工具优先展示 description，缺省时回退到命令本体', () => {
    expect(getToolLabel(toolCall('execute_command', { command: 'pnpm install', description: '安装项目依赖' })).primary)
      .toBe('安装项目依赖')
    expect(getToolLabel(toolCall('execute_command', { command: 'pnpm install' })).primary).toBe('pnpm install')
  })

  it('browser 工具展示对应操作', () => {
    expect(getToolLabel(toolCall('browser_navigate', { url: 'https://a.com' })).primary)
      .toBe('打开 https://a.com')
    expect(getToolLabel(toolCall('browser_snapshot')).primary).toBe('页面快照')
    expect(getToolLabel(toolCall('browser_click', { ref: '@e3' })).primary).toBe('点击 @e3')
    expect(getToolLabel(toolCall('browser_eval')).primary).toBe('执行 JS')
  })

  it('技能与记忆工具展示名称', () => {
    expect(getToolLabel(toolCall('use_skill', { name: 'pdf' })).primary).toBe('使用技能 pdf')
    expect(getToolLabel(toolCall('install_skill_from_github', { name: 'pdf' })).primary).toBe('安装技能 pdf')
    expect(getToolLabel(toolCall('install_skill_from_github', { url: 'https://github.com/a/b' })).primary)
      .toBe('安装技能 https://github.com/a/b')
    expect(getToolLabel(toolCall('memory', { target: 'memory' })).primary).toBe('更新记忆（memory）')
  })

  it('requestSecret 展示 label，缺省时提示多个字段', () => {
    expect(getToolLabel(toolCall('requestSecret', { label: '部署密码' })).primary).toBe('请求敏感信息 部署密码')
    expect(getToolLabel(toolCall('requestSecret', {})).primary).toBe('请求敏感信息 多个字段')
  })

  it('publish_visualization 与未知工具', () => {
    expect(getToolLabel(toolCall('publish_visualization')).primary).toBe('发布可视化')
    expect(getToolLabel(toolCall('some_unknown_tool')).primary).toBe('some_unknown_tool')
  })

  it('edit_file 附带增删行统计', () => {
    const label = getToolLabel(toolCall('edit_file', {
      path: 'src/a.ts',
      edits: [{ oldText: 'const a = 1', newText: 'const a = 2\nconst b = 3' }],
    }))
    expect(label.primary).toBe('编辑 src/a.ts')
    expect(label.diff).toEqual({ added: 2, removed: 1 })
  })

  it('mCP 工具展示短名与 serverName 次要文本', () => {
    const label = getToolLabel(toolCall('github___create_issue', { title: 'x' }))
    expect(label.primary).toBe('create_issue')
    expect(label.secondary).toBe('github')
  })
})

describe('splitToolName', () => {
  it('按 ___ 拆分 MCP 工具名，serverName 字段优先', () => {
    expect(splitToolName(toolCall('github___create_issue'))).toEqual({
      isMcp: true,
      serverName: 'github',
      shortName: 'create_issue',
    })
    expect(splitToolName(toolCall('github___create_issue', {}, 'gh')).serverName).toBe('gh')
  })

  it('原生工具名含单下划线不会被误拆分', () => {
    expect(splitToolName(toolCall('read_file'))).toEqual({ isMcp: false, shortName: 'read_file' })
  })
})

describe('getToolCategory', () => {
  it('内置工具映射到对应类别，未知工具归为 other', () => {
    expect(getToolCategory(toolCall('read_file'))).toBe('read')
    expect(getToolCategory(toolCall('edit_file'))).toBe('edit')
    expect(getToolCategory(toolCall('execute_command'))).toBe('command')
    expect(getToolCategory(toolCall('install_skill_from_github'))).toBe('skill')
    expect(getToolCategory(toolCall('mcp___do_thing'))).toBe('other')
    expect(getToolCategory(toolCall('whatever'))).toBe('other')
  })

  it.each([
    'read_file',
    'edit_file',
    'write_file',
    'grep_files',
    'glob_files',
    'list_dir',
    'execute_command',
    'browser_navigate',
    'browser_snapshot',
    'browser_click',
    'use_skill',
    'install_skill_from_github',
    'memory',
  ])('mCP 工具短名与内置工具 %s 碰撞时仍归为 other', (shortName) => {
    expect(getToolCategory(toolCall(`server___${shortName}`))).toBe('other')
  })
})

describe('parseCommandResult', () => {
  it('剥掉 stdout/stderr 标记行并按原顺序合并输出', () => {
    const parsed = parseCommandResult('stdout:\nline-1\nstderr:\noops\nexitCode=0')
    expect(parsed.output).toBe('line-1\noops')
    expect(parsed.exitCode).toBe(0)
  })

  it('解析非零退出码并去掉尾部多余换行', () => {
    const parsed = parseCommandResult('stdout:\nboom\n\nexitCode=3')
    expect(parsed.output).toBe('boom')
    expect(parsed.exitCode).toBe(3)
  })
})

describe('buildCommandSessionText', () => {
  it('无输出时只展示命令行', () => {
    expect(buildCommandSessionText('pwd', 'bash', 'stdout:\nexitCode=0')).toBe('$ pwd')
  })

  it('合并输出展示在命令之后，零退出码不展示', () => {
    expect(buildCommandSessionText('ls', 'bash', 'stdout:\na.txt\nexitCode=0')).toBe('$ ls\na.txt')
  })

  it('失败命令保留 exit N 行', () => {
    expect(buildCommandSessionText('ls missing', 'bash', 'stderr:\nnot found\nexitCode=1'))
      .toBe('$ ls missing\nnot found\nexit 1')
  })

  it.each([
    ['powershell7', 'PS> Get-ChildItem', 'powershell'],
    ['windows-powershell', 'PS> Get-ChildItem', 'powershell'],
    ['cmd', '> dir', 'batch'],
  ] as const)('%s 使用对应提示符和语法高亮', (interpreter, session, language) => {
    const command = interpreter === 'cmd' ? 'dir' : 'Get-ChildItem'
    expect(buildCommandSessionText(command, interpreter)).toBe(session)
    expect(getCommandLanguage(interpreter)).toBe(language)
  })
})

describe('getEditStats', () => {
  it('统计所有 edit 的新旧行数，末尾换行不多计', () => {
    expect(getEditStats({
      edits: [
        { oldText: 'a\nb\n', newText: 'c\n' },
        { oldText: '', newText: 'd\ne' },
      ],
    })).toEqual({ added: 3, removed: 2 })
  })

  it('缺少 edits 参数时返回 null', () => {
    expect(getEditStats({})).toBeNull()
  })
})

describe('buildEditDiff', () => {
  it('合成带文件头的 diff，多个 edit 依次追加 hunk', () => {
    expect(buildEditDiff({
      path: 'src/a.ts',
      edits: [
        { oldText: 'const a = 1', newText: 'const a = 2' },
        { oldText: '', newText: 'const b = 3' },
      ],
    })).toBe([
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@',
      '-const a = 1',
      '+const a = 2',
      '@@',
      '+const b = 3',
    ].join('\n'))
  })

  it('缺少 path 或 edits 时返回 null', () => {
    expect(buildEditDiff({ edits: [] })).toBeNull()
    expect(buildEditDiff({ path: 'src/a.ts' })).toBeNull()
  })
})

describe('getLanguageFromPath', () => {
  it('按扩展名映射 shiki 语言，未命中回退 text', () => {
    expect(getLanguageFromPath('src/a.ts')).toBe('typescript')
    expect(getLanguageFromPath('README.md')).toBe('markdown')
    expect(getLanguageFromPath('script.sh')).toBe('bash')
    expect(getLanguageFromPath('data.unknownext')).toBe('text')
    expect(getLanguageFromPath('LICENSE')).toBe('text')
  })

  it('dockerfile 无扩展名也映射', () => {
    expect(getLanguageFromPath('deploy/Dockerfile')).toBe('docker')
  })
})
