import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CollapsibleMessageText } from '../CollapsibleMessageText'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('collapsibleMessageText 长文本折叠', () => {
  it('内容不足阈值时不裁剪、不显示「显示更多」', () => {
    render(
      <CollapsibleMessageText>
        <p>短文本</p>
      </CollapsibleMessageText>,
    )

    expect(screen.queryByRole('button', { name: '显示更多' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '收起' })).not.toBeInTheDocument()
  })

  it('长内容默认折叠，点击「显示更多」展开全部，再点「收起」恢复折叠', () => {
    // jsdom 无布局：模拟内容高度超出裁剪高度
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)

    render(
      <CollapsibleMessageText>
        <p>{'很长的用户消息内容。'.repeat(50)}</p>
      </CollapsibleMessageText>,
    )

    const expandButton = screen.getByRole('button', { name: '显示更多' })
    expect(expandButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(expandButton)

    const collapseButton = screen.getByRole('button', { name: '收起' })
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(collapseButton)

    expect(screen.getByRole('button', { name: '显示更多' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})
