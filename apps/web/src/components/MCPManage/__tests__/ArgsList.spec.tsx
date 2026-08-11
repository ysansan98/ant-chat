import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ArgsList } from '../ArgsList'

function renderArgsList(value?: string[], onChange?: (args: string[]) => void) {
  render(<ArgsList value={value} onChange={onChange} />)
}

describe('argsList', () => {
  it('空参数时展示一行空输入和添加按钮', () => {
    renderArgsList([])

    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '添加参数' })).toBeInTheDocument()
  })

  it('每个参数一个输入框，最后一行是添加按钮，其余是删除按钮', () => {
    renderArgsList(['-y', 'mcp-remote'])

    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(2)
    expect(inputs[0]).toHaveValue('-y')
    expect(inputs[1]).toHaveValue('mcp-remote')
    expect(screen.getByRole('button', { name: '删除参数 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加参数' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除参数 2' })).not.toBeInTheDocument()
  })

  it('点击添加按钮在末尾追加空参数行', () => {
    const onChange = vi.fn()
    renderArgsList(['-y'], onChange)

    fireEvent.click(screen.getByRole('button', { name: '添加参数' }))

    expect(onChange).toHaveBeenCalledWith(['-y', ''])
  })

  it('点击删除按钮移除对应行', () => {
    const onChange = vi.fn()
    renderArgsList(['-y', 'mcp-remote', 'https://example.com'], onChange)

    fireEvent.click(screen.getByRole('button', { name: '删除参数 2' }))

    expect(onChange).toHaveBeenCalledWith(['-y', 'https://example.com'])
  })

  it('修改输入框内容时回调更新对应参数', () => {
    const onChange = vi.fn()
    renderArgsList(['-y', 'mcp-remote'], onChange)

    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'tavily-mcp' } })

    expect(onChange).toHaveBeenCalledWith(['-y', 'tavily-mcp'])
  })
})
