/** markdown 文件（支持 Preview/Source 双模式）判断 */
export function isMarkdownFileName(name: string): boolean {
  const base = name.toLowerCase()
  return base.endsWith('.md') || base.endsWith('.markdown')
}
