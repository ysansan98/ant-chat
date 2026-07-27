import type { CommandInterpreter, ToolCallContent } from '@ant-chat/shared'
import { DEFAULT_MCP_TOOL_NAME_SEPARATOR } from '@ant-chat/shared'

/**
 * 工具调用在消息列表中的展示模型。
 * 所有函数均为纯函数，便于单测与在审批卡片等场景复用。
 */
export interface ToolLabel {
  /** 主文案，如「读取 src/a.ts」 */
  primary: string
  /** 次要灰色文本，如 MCP 的 serverName */
  secondary?: string
  /** edit_file 的增删行统计 */
  diff?: { added: number, removed: number }
}

interface SplitToolName {
  isMcp: boolean
  serverName?: string
  shortName: string
}

/**
 * tool-call 块在 loop 中不落 serverName 字段，MCP 工具需从 toolName 拆分；
 * 原生工具名只含单下划线，不会误命中 DEFAULT_MCP_TOOL_NAME_SEPARATOR（'___'）。
 */
export function splitToolName(toolCall: ToolCallContent): SplitToolName {
  const index = toolCall.toolName.indexOf(DEFAULT_MCP_TOOL_NAME_SEPARATOR)
  if (index > 0) {
    return {
      isMcp: true,
      serverName: toolCall.serverName ?? toolCall.toolName.slice(0, index),
      shortName: toolCall.toolName.slice(index + DEFAULT_MCP_TOOL_NAME_SEPARATOR.length),
    }
  }
  return { isMcp: false, shortName: toolCall.toolName }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 各内置工具的 header 文案 */
export function getToolLabel(toolCall: ToolCallContent): ToolLabel {
  const args = (toolCall.args ?? {}) as Record<string, unknown>
  const { isMcp, serverName, shortName } = splitToolName(toolCall)

  if (isMcp) {
    return { primary: shortName, secondary: serverName }
  }

  switch (shortName) {
    case 'read_file':
      return { primary: `读取 ${str(args.path)}` }
    case 'write_file':
      return { primary: `写入 ${str(args.path)}` }
    case 'edit_file': {
      const diff = getEditStats(args)
      return { primary: `编辑 ${str(args.path)}`, diff: diff ?? undefined }
    }
    case 'grep_files':
      return { primary: `搜索 ${str(args.pattern)}` }
    case 'glob_files':
      return { primary: `查找 ${str(args.pattern)}` }
    case 'list_dir':
      return { primary: `列出 ${str(args.path) || '.'}` }
    case 'execute_command':
      // description 由模型填写，说明命令意图；缺省时回退到命令本体
      return { primary: str(args.description) || str(args.command) || 'execute_command' }
    case 'browser': {
      const firstArg = Array.isArray(args.args) && typeof args.args[0] === 'string'
        ? ` ${args.args[0]}`
        : ''
      return { primary: `浏览器 ${str(args.command)}${firstArg}`.trim() }
    }
    case 'use_skill':
      return { primary: `使用技能 ${str(args.name)}` }
    case 'install_skill_from_github':
      return { primary: `安装技能 ${str(args.name) || str(args.url)}` }
    case 'memory':
      return { primary: `更新记忆（${str(args.target)}）` }
    case 'requestSecret':
      return { primary: `请求敏感信息 ${str(args.label) || '多个字段'}` }
    case 'publish_visualization':
      return { primary: '发布可视化' }
    default:
      return { primary: toolCall.toolName }
  }
}

// ---- 工具类别与汇总 ----

export type ToolCategory
  = | 'read' | 'edit' | 'write' | 'grep' | 'glob' | 'list'
    | 'command' | 'browser' | 'skill' | 'memory' | 'other'

const CATEGORY_BY_TOOL: Record<string, ToolCategory> = {
  read_file: 'read',
  edit_file: 'edit',
  write_file: 'write',
  grep_files: 'grep',
  glob_files: 'glob',
  list_dir: 'list',
  execute_command: 'command',
  browser: 'browser',
  use_skill: 'skill',
  install_skill_from_github: 'skill',
  memory: 'memory',
}

export function getToolCategory(toolCall: ToolCallContent): ToolCategory {
  const { isMcp, shortName } = splitToolName(toolCall)
  if (isMcp) {
    return 'other'
  }
  return CATEGORY_BY_TOOL[shortName] ?? 'other'
}

/** 汇总文案的输出顺序与格式，0 次的类别在汇总时跳过 */
export const TOOL_CATEGORY_SUMMARY: ReadonlyArray<{ category: ToolCategory, format: (n: number) => string }> = [
  { category: 'read', format: n => `读取 ${n} 次` },
  { category: 'edit', format: n => `编辑 ${n} 次` },
  { category: 'write', format: n => `写入 ${n} 次` },
  { category: 'grep', format: n => `搜索 ${n} 次` },
  { category: 'glob', format: n => `查找 ${n} 次` },
  { category: 'list', format: n => `列目录 ${n} 次` },
  { category: 'command', format: n => `运行 ${n} 条命令` },
  { category: 'browser', format: n => `浏览器操作 ${n} 次` },
  { category: 'skill', format: n => `使用技能 ${n} 次` },
  { category: 'memory', format: n => `记忆操作 ${n} 次` },
  { category: 'other', format: n => `调用工具 ${n} 次` },
]

// ---- command ----

export interface ParsedCommandResult {
  /** 剥掉 stdout:/stderr: 标记后按原顺序合并的输出 */
  output: string
  exitCode?: number
}

/**
 * 命令结果字符串由后端 formatProcessResult 生成：
 * `stdout:\n…\nstderr:\n…\nexitCode=N`（各段可缺省）。
 * 消息列表不区分 stdout/stderr，这里只解析用于展示，后端格式保持不变（模型仍读原文）。
 */
export function parseCommandResult(result: string): ParsedCommandResult {
  const outputLines: string[] = []
  let exitCode: number | undefined

  for (const line of result.split('\n')) {
    if (line === 'stdout:' || line === 'stderr:') {
      continue
    }
    const exitMatch = /^exitCode=(\d+)$/.exec(line)
    if (exitMatch) {
      exitCode = Number(exitMatch[1])
      continue
    }
    outputLines.push(line)
  }

  return { output: outputLines.join('\n').replace(/\n+$/, ''), exitCode }
}

/** 命令展开体使用实际解释器的提示符，随后合并输出，退出码仅非 0 时展示。 */
export function buildCommandSessionText(command: string, interpreter: CommandInterpreter, result?: string): string {
  const lines = [`${getCommandPrompt(interpreter)} ${command}`]
  if (result) {
    const { output, exitCode } = parseCommandResult(result)
    if (output) {
      lines.push(output)
    }
    if (exitCode !== undefined && exitCode !== 0) {
      lines.push(`exit ${exitCode}`)
    }
  }
  return lines.join('\n')
}

export function getCommandLanguage(interpreter: CommandInterpreter): 'bash' | 'powershell' | 'batch' {
  if (interpreter === 'bash')
    return 'bash'
  if (interpreter === 'cmd')
    return 'batch'
  return 'powershell'
}

function getCommandPrompt(interpreter: CommandInterpreter): '$' | 'PS>' | '>' {
  if (interpreter === 'bash')
    return '$'
  if (interpreter === 'cmd')
    return '>'
  return 'PS>'
}

// ---- edit_file ----

interface EditArg {
  oldText?: unknown
  newText?: unknown
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0
  }
  return text.replace(/\n$/, '').split('\n').length
}

/** 从调用参数统计增删行数（无需等待执行结果，执行中即可展示） */
export function getEditStats(args: Record<string, unknown>): { added: number, removed: number } | null {
  if (!Array.isArray(args.edits)) {
    return null
  }
  let added = 0
  let removed = 0
  for (const edit of args.edits as EditArg[]) {
    if (edit && typeof edit.newText === 'string') {
      added += countLines(edit.newText)
    }
    if (edit && typeof edit.oldText === 'string') {
      removed += countLines(edit.oldText)
    }
  }
  return { added, removed }
}

/**
 * 由调用参数合成 diff 文本（无文件上下文行，hunk 头退化为 `@@`）。
 * 失败调用由上层改展示错误文本，不走这里。
 */
export function buildEditDiff(args: Record<string, unknown>): string | null {
  const filePath = str(args.path)
  if (!filePath || !Array.isArray(args.edits)) {
    return null
  }
  const parts = [`--- a/${filePath}`, `+++ b/${filePath}`]
  for (const edit of args.edits as EditArg[]) {
    const oldText = edit && typeof edit.oldText === 'string' ? edit.oldText : ''
    const newText = edit && typeof edit.newText === 'string' ? edit.newText : ''
    parts.push('@@')
    if (oldText) {
      for (const line of oldText.replace(/\n$/, '').split('\n')) {
        parts.push(`-${line}`)
      }
    }
    if (newText) {
      for (const line of newText.replace(/\n$/, '').split('\n')) {
        parts.push(`+${line}`)
      }
    }
  }
  return parts.join('\n')
}

// ---- 语言推断 ----

/** 仅映射 shiki-langs 中已打包的语言，未命中回退 text（shiki 内置，无需语法包） */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  java: 'java',
  go: 'go',
  rs: 'rust',
  json: 'json',
  jsonc: 'jsonc',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sh: 'bash',
  ps1: 'powershell',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  md: 'markdown',
  mdx: 'mdx',
  c: 'c',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  kt: 'kotlin',
  dart: 'dart',
  toml: 'toml',
  ini: 'ini',
  lua: 'lua',
  vue: 'vue',
  diff: 'diff',
}

export function getLanguageFromPath(filePath: string): string {
  const name = filePath.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile') {
    return 'docker'
  }
  const extension = name.includes('.') ? name.split('.').pop()! : ''
  return LANGUAGE_BY_EXTENSION[extension] ?? 'text'
}
