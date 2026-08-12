import { Markdown } from '@workspace/ui/components/ai-elements/markdown'

/**
 * Markdown 预览（渲染模式）。
 * 使用 streamdown 默认预设（GFM、代码高亮、KaTeX、mermaid、rehype-raw + sanitize + harden、
 * linkSafety），与聊天气泡渲染一致；组件内部固定 mode="static" 面向静态文件内容。
 * 路径与大小由外层 FileContentArea 头部展示，这里只渲染正文。
 */
export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto px-4 py-3 text-sm" data-testid="markdown-preview">
      <Markdown>{content}</Markdown>
    </div>
  )
}
