import React from 'react'

interface HighlightTextProps {
  /**
   * 要显示的完整文本
   */
  text: string
  /**
   * 要高亮的关键字，支持字符串或字符串数组
   */
  keywords: string | string[]
  /**
   * 高亮部分的样式类名
   */
  highlightClassName?: string
  /**
   * 容器的样式类名
   */
  className?: string
  /**
   * 是否忽略大小写，默认为 true
   */
  ignoreCase?: boolean
  /**
   * 自定义高亮渲染函数
   */
  renderHighlight?: (text: string, index: number) => React.ReactNode
}

/**
 * 文本高亮组件
 * 用于在文本中高亮显示指定的关键字
 */
export function HighlightText({
  text,
  keywords,
  highlightClassName = 'bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100',
  className = '',
  ignoreCase = true,
  renderHighlight,
}: HighlightTextProps) {
  // 如果没有关键字或文本为空，直接返回原文本
  if (!keywords || !text) {
    return <span className={className}>{text}</span>
  }

  // 统一处理关键字为数组
  const keywordArray = Array.isArray(keywords) ? keywords : [keywords]

  // 过滤空关键字
  const validKeywords = keywordArray.filter(keyword => keyword && keyword.trim())

  if (validKeywords.length === 0) {
    return <span className={className}>{text}</span>
  }

  // 创建正则表达式来匹配所有关键字
  const escapedKeywords = validKeywords.map(keyword =>
    keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  )

  const regex = new RegExp(
    `(${escapedKeywords.join('|')})`,
    ignoreCase ? 'gi' : 'g',
  )

  // 分割文本
  const parts = text.split(regex)

  if (parts.length <= 1) {
    return <span className={className}>{text}</span>
  }

  return (
    <span className={className}>
      {parts.map((part, index) => {
        // 检查当前部分是否是关键字
        const isKeyword = validKeywords.some(keyword =>
          ignoreCase
            ? part.toLowerCase() === keyword.toLowerCase()
            : part === keyword,
        )

        if (isKeyword && part) {
          // 如果有自定义渲染函数，使用自定义渲染
          if (renderHighlight) {
            return renderHighlight(part, index)
          }

          // 默认高亮渲染
          return (
            <span
              key={index}
              className={highlightClassName}
            >
              {part}
            </span>
          )
        }

        return <span key={index}>{part}</span>
      })}
    </span>
  )
}
