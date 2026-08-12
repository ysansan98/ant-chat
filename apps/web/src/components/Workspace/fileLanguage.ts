import type { CodeBlock } from '@workspace/ui/components/ai-elements/code-block'
import type { ComponentProps } from 'react'

type CodeBlockLanguage = ComponentProps<typeof CodeBlock>['language']
/** shiki 未匹配语言时的回退标识（非 BundledLanguage 字面量，需显式转换） */
const TEXT_LANGUAGE = 'text' as CodeBlockLanguage

/** 扩展名（小写）→ shiki 语言。未知扩展名回退 'text'（无高亮）。 */
const EXTENSION_LANGUAGES: Record<string, CodeBlockLanguage> = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.json5': 'json5',
  '.jsonl': 'jsonl',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'mdx',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
  '.svg': 'xml',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.sass': 'sass',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.dart': 'dart',
  '.scala': 'scala',
  '.lua': 'lua',
  '.pl': 'perl',
  '.r': 'r',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.hs': 'haskell',
  '.clj': 'clojure',
  '.zig': 'zig',
  '.nim': 'nim',
  '.prisma': 'prisma',
  '.tf': 'terraform',
  '.tfvars': 'terraform',
  '.hcl': 'hcl',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'proto',
  '.sol': 'solidity',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',
  '.diff': 'diff',
  '.patch': 'diff',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.fish': 'fish',
  '.ps1': 'powershell',
  '.bat': 'bat',
  '.cmd': 'bat',
  '.sql': 'sql',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.env': 'dotenv',
  '.properties': 'properties',
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.log': 'log',
  '.tex': 'latex',
  '.latex': 'latex',
  '.http': 'http',
  '.mmd': 'mermaid',
}

/** 无扩展名的特例文件名 → shiki 语言。 */
const FILENAME_LANGUAGES: Record<string, CodeBlockLanguage> = {
  'Dockerfile': 'dockerfile',
  'Makefile': 'makefile',
  'CMakeLists.txt': 'cmake',
  'Jenkinsfile': 'groovy',
  '.gitattributes': 'ini',
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
}

/** 根据文件名检测预览语言；未知时回退 'text'。 */
export function detectFileLanguage(fileName: string): CodeBlockLanguage {
  const baseName = fileName.split('/').pop() ?? fileName
  const byName = FILENAME_LANGUAGES[baseName]
  if (byName) {
    return byName
  }
  if (baseName === '.env' || baseName.startsWith('.env.')) {
    return 'dotenv'
  }
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return TEXT_LANGUAGE
  }
  return EXTENSION_LANGUAGES[baseName.slice(dotIndex).toLowerCase()] ?? TEXT_LANGUAGE
}
