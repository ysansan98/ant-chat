import type { SearchResult } from '@ant-chat/shared'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchApi } from '@/api/searchApi'
import { SearchBar } from '../SearchBar'

vi.mock('@/api/searchApi', () => ({
  searchApi: {
    searchByKeyword: vi.fn(async () => []),
  },
}))

const mockedSearchApi = vi.mocked(searchApi)

const results: SearchResult[] = [{
  type: 'message',
  id: 'conv-1',
  conversationId: 'conv-1',
  conversationTitle: '会话一',
  createdAt: 1,
  messages: [
    { id: 'msg-1', content: '第一条消息', createdAt: 1 },
    { id: 'msg-2', content: '第二条消息', createdAt: 2 },
  ],
}]

describe('searchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockedSearchApi.searchByKeyword.mockResolvedValue(results)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('使用紧凑浮层而非全屏搜索面板', () => {
    render(<SearchBar onItemClick={vi.fn()} />)

    expect(screen.getByTestId('search-panel')).toHaveClass(
      'w-[calc(100%-1.5rem)]',
      'max-w-lg',
      'rounded-xl',
    )
    expect(screen.getByTestId('search-panel')).not.toHaveClass('inset-0')
  })

  it('输入关键词后防抖搜索并渲染结果', async () => {
    render(<SearchBar onItemClick={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('搜索会话'), { target: { value: '消息' } })

    // 防抖窗口内不应发起请求
    expect(mockedSearchApi.searchByKeyword).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(mockedSearchApi.searchByKeyword).toHaveBeenCalledTimes(1)
    expect(mockedSearchApi.searchByKeyword).toHaveBeenCalledWith('消息')

    // conversationTitle 不含关键词，可按完整文本匹配
    expect(screen.getByText('会话一')).toBeInTheDocument()
  })

  it('点击结果项时回调 onItemClick 并携带对应 messageId', async () => {
    const onItemClick = vi.fn()
    render(<SearchBar onItemClick={onItemClick} />)

    fireEvent.change(screen.getByPlaceholderText('搜索会话'), { target: { value: '消息' } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    // 高亮会把关键词拆成独立 span，name 形如 "1 第一条 消息"，按不含空格的子串匹配
    fireEvent.click(screen.getByRole('button', { name: /第一条/ }))

    expect(onItemClick).toHaveBeenCalledWith(results[0], 'msg-1')
  })
})
