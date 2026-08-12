import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownPreview } from './MarkdownPreview'

describe('markdownPreview', () => {
  it('渲染 GFM 标题与表格', () => {
    render(<MarkdownPreview content={'# 标题\n\n| a | b |\n| - | - |\n| 1 | 2 |'} />)

    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('按 streamdown 默认预设解析原始 HTML：保留安全标签、剥离脚本', () => {
    render(<MarkdownPreview content={'<b>加粗</b>\n\n<script>alert(1)</script>'} />)

    // rehype-raw + sanitize：b 标签保留
    expect(screen.getByText('加粗').closest('b')).not.toBeNull()
    // script 被 sanitize 剥离，不进入 DOM
    expect(screen.queryByText(/alert/)).not.toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })
})
