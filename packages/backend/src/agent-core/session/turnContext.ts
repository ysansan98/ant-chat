export interface TurnContextOptions {
  prompt: string
  referencedFiles?: string[]
}

export function buildPromptWithTurnContext(options: TurnContextOptions): string {
  const prompt = options.prompt.trim()
  const referencedFiles = normalizeReferencedFiles(options.referencedFiles)

  if (referencedFiles.length === 0) {
    return prompt || ''
  }

  const context: string[] = ['<turn_context>']

  context.push('用户通过 @ 引用了以下当前工作区文件。需要文件内容时，必须使用 read_file 读取，不要臆测内容：')
  for (const file of referencedFiles) {
    context.push(`- ${file}`)
  }

  context.push('</turn_context>')

  return prompt ? `${context.join('\n')}\n\n${prompt}` : context.join('\n')
}

function normalizeReferencedFiles(files?: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const file of files || []) {
    const value = file.trim()
    if (!value || value.startsWith('/') || value.includes('..')) {
      continue
    }
    if (seen.has(value)) {
      continue
    }
    seen.add(value)
    result.push(value)
  }

  return result
}
