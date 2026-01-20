import { Typography } from 'antd'
import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkAlert } from 'remark-github-blockquote-alert'
import { visit } from 'unist-util-visit'
import { useThemeStore } from '@/store/theme'
import CodeBlock from './CodeBlock'
import style from './style.module.scss'
import 'remark-github-blockquote-alert/alert.css'

export interface RenderMarkdownProps {
  content: string
}

// 创建默认语言插件
function defaultLangPlugin() {
  return (tree: any) => {
    visit(tree, 'code', (node: any) => {
      node.lang = node.lang ?? 'plaintext'
    })
  }
}

export default function RenderMarkdown({ content }: RenderMarkdownProps) {
  const theme = useThemeStore(state => state.theme)

  const remarkPlugins = useMemo(() => [
    defaultLangPlugin,
    remarkGfm,
    remarkAlert,
  ], [])

  const components = useMemo(() => ({
    code: (props: any) => {
      const { children, className } = props
      const language = className ? className.replace('language-', '') : 'txt'

      return className
        ? (
            <CodeBlock language={language} theme={theme}>
              {children}
            </CodeBlock>
          )
        : (
            <code>
              {children}
            </code>
          )
    },
  }), [theme])

  return (
    <Typography className={style['markdown-typography']}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={components}
        urlTransform={url => url}
      >
        {content}
      </ReactMarkdown>
    </Typography>
  )
}
