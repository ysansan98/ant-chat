import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ImagePreview } from './previews/ImagePreview'

describe('imagePreview', () => {
  it('渲染图片并展示工具栏', () => {
    render(<ImagePreview url="https://example.com/a.png" fileName="a.png" />)
    const img = screen.getByAltText('a.png')
    expect(img).toHaveAttribute('src', 'https://example.com/a.png')
    expect(screen.getByRole('button', { name: '放大' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '缩小' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '顺时针旋转' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '逆时针旋转' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重置' })).toBeInTheDocument()
  })

  it('放大按钮增加缩放比例', () => {
    render(<ImagePreview url="https://example.com/a.png" fileName="a.png" />)
    expect(screen.getByText('100%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(screen.getByText('120%')).toBeInTheDocument()
  })

  it('缩小按钮降低缩放比例', () => {
    render(<ImagePreview url="https://example.com/a.png" fileName="a.png" />)
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    expect(screen.getByText('140%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '缩小' }))
    expect(screen.getByText('120%')).toBeInTheDocument()
  })

  it('旋转按钮改变旋转角度', () => {
    render(<ImagePreview url="https://example.com/a.png" fileName="a.png" />)
    const img = screen.getByAltText('a.png')

    fireEvent.click(screen.getByRole('button', { name: '顺时针旋转' }))
    expect(img.style.transform).toContain('rotate(90deg)')

    fireEvent.click(screen.getByRole('button', { name: '逆时针旋转' }))
    expect(img.style.transform).toContain('rotate(0deg)')
  })

  it('重置按钮恢复初始状态', () => {
    render(<ImagePreview url="https://example.com/a.png" fileName="a.png" />)
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    fireEvent.click(screen.getByRole('button', { name: '顺时针旋转' }))
    expect(screen.getByText('120%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('缩小不低于下限', () => {
    render(<ImagePreview url="https://example.com/a.png" fileName="a.png" />)
    const zoomOut = screen.getByRole('button', { name: '缩小' })
    // 连续点击多次，不应低于 20%
    for (let i = 0; i < 10; i++) {
      fireEvent.click(zoomOut)
    }
    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(zoomOut).toBeDisabled()
  })
})
