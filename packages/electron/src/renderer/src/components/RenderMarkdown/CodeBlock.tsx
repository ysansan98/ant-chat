import type { SupportedLanguages } from '../RunnerCode'
import { CopyOutlined, DownOutlined, PlayCircleFilled } from '@ant-design/icons'
import { Button } from 'antd'
import { useState } from 'react'
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import materialDark from 'react-syntax-highlighter/dist/esm/styles/prism/material-dark'
import materialLight from 'react-syntax-highlighter/dist/esm/styles/prism/material-light'
import { clipboardWrite } from '@/utils'
import { useRunnerCodeContext } from '../RunnerCode'

interface CodeBlockProps {
  children?: React.ReactNode
  language: string
  theme?: 'light' | 'dark'
}

const preKey = 'pre[class*="language-"]'
const codeKey = 'code[class*="language-"]'
const fontFamily = `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace`

function CodeBlock({ language, children, theme = 'light' }: CodeBlockProps) {
  const [showCode, setShowCode] = useState(true)
  const [copySuccess, setCopySuccess] = useState(false)
  // const { setContent } = useMermaidContext()
  const { updateConfig } = useRunnerCodeContext()

  const _style = { ...theme === 'light' ? materialLight : materialDark }

  /** 调整主题样式 */
  const preStyle = _style[preKey]
  const codeStyle = _style[codeKey]
  const style = {
    ..._style,
    [preKey]: { ...preStyle, margin: '0px' },
    [codeKey]: { ...codeStyle, fontFamily },
  }

  return (
    <div className="rounded-md border-[1px] border-solid border-gray-400/20">
      {/* 代码块header */}
      <div className="flex items-center justify-between px-2 py-1 select-none">
        <div
          className="flex cursor-pointer items-center gap-2"
          onClick={() => setShowCode(!showCode)}
          style={{ fontFamily }}
        >
          <DownOutlined rotate={showCode ? 0 : -90} />
          {language}
        </div>
        <div className="flex cursor-pointer justify-end gap-2 text-xs">
          {copySuccess && <span className="text-blue-400">复制成功</span>}
          <CopyOutlined
            className="hover:text-blue-400"
            onClick={() => {
              setCopySuccess(true)
              const text = String(children)
              clipboardWrite({ text })
              setTimeout(() => {
                setCopySuccess(false)
              }, 1000)
            }}
          />
        </div>
      </div>
      <div className={`
        overflow-hidden transition-[height]
        ${!showCode && 'h-0'}
      `}
      >
        <SyntaxHighlighter
          showLineNumbers
          wrapLines
          language={language}
          style={style}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      </div>
      {
        ['mermaid', 'html'].includes(language.toLowerCase()) && (
          <div className="flex items-center justify-end gap-2 px-2 py-1">
            <Button
              type="text"
              size="small"
              icon={<PlayCircleFilled />}
              onClick={() => {
                updateConfig((draft) => {
                  draft.code = String(children)
                  draft.language = language as SupportedLanguages
                })
              }}
            >
              运行代码
            </Button>
          </div>
        )
      }
    </div>
  )
}

export default CodeBlock
