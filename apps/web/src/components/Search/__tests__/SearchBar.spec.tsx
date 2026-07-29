import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SearchBar } from '../SearchBar'

vi.mock('@/api/searchApi', () => ({
  searchApi: {
    searchByKeyword: vi.fn(async () => []),
  },
}))

describe('searchBar', () => {
  it('使用紧凑浮层而非全屏搜索面板', () => {
    render(<SearchBar onClose={vi.fn()} onItemClick={vi.fn()} />)

    expect(screen.getByTestId('search-panel')).toHaveClass(
      'w-[calc(100%-1.5rem)]',
      'max-w-lg',
      'rounded-xl',
    )
    expect(screen.getByTestId('search-panel')).not.toHaveClass('inset-0')
  })

  it('允许通过关闭按钮退出搜索', () => {
    const onClose = vi.fn()

    render(<SearchBar onClose={onClose} onItemClick={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '关闭搜索' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
