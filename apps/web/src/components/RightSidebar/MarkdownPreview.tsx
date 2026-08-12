import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Markdown 预览（渲染模式）。
 * 样式由 index.css 中 .markdown-preview 作用域提供，全部使用语义色 token；
 * 不引入 rehype-raw，原始 HTML 会被 react-markdown 转义，避免本地文件 XSS。
 * 路径与大小由外层 FileContentArea 头部展示，这里只渲染正文。
 */
export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-preview h-full min-h-0 overflow-y-auto px-4 py-3" data-testid="markdown-preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
