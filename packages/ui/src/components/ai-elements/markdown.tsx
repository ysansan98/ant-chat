'use client'

import type { ComponentProps } from 'react'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { mermaid } from '@streamdown/mermaid'
import { cn } from '@workspace/ui/lib/utils'
import { memo } from 'react'
import { Streamdown } from 'streamdown'

export type MarkdownProps = ComponentProps<typeof Streamdown>

// 与 MessageResponse（ai-elements/message.tsx）共用同一套 streamdown 插件预设
const streamdownPlugins = { cjk, code, math, mermaid }

/**
 * 静态 Markdown 渲染（非流式场景，如右侧栏文件预览）。
 *
 * 固定 mode="static"：跳过 remend 不完整块处理、动画与 caret 逻辑；
 * 其余保持 streamdown 默认预设（GFM、rehype-raw + sanitize + harden、linkSafety、controls）。
 */
export const Markdown = memo(
  ({ className, ...props }: MarkdownProps) => (
    <Streamdown
      className={cn('size-full', className)}
      mode="static"
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
)

Markdown.displayName = 'Markdown'
