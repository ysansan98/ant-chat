import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AddModelFormModal } from './AddModelForm'

function renderModal() {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  render(
    <AddModelFormModal
      open
      title="添加模型"
      onSave={onSave}
      onCancel={onCancel}
    />,
  )
  return { onSave, onCancel }
}

// 模拟父组件持有 open 状态：弹窗关闭后组件不卸载，再次打开仍复用同一实例。
function renderHarness() {
  const onSave = vi.fn()
  function Harness() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>打开</button>
        <AddModelFormModal
          open={open}
          title="添加模型"
          onSave={(data) => {
            onSave(data)
            setOpen(false) // 与 ModelList 行为一致：保存成功后关闭
          }}
          onCancel={() => setOpen(false)}
        />
      </>
    )
  }
  render(<Harness />)
  return { onSave }
}

describe('addModelFormModal 推理强度', () => {
  it('推理开关默认关闭时不展示推理强度选项', () => {
    renderModal()
    expect(screen.queryByText('推理强度')).not.toBeInTheDocument()
  })

  it('打开推理开关后展示全部推理强度档位', () => {
    renderModal()
    fireEvent.click(screen.getByRole('switch', { name: '推理' }))

    expect(screen.getByText('推理强度')).toBeInTheDocument()
    for (const label of ['关闭', '极简', '低', '中', '高', '极高']) {
      expect(screen.getByRole('button', { name: `推理强度 ${label}` })).toBeInTheDocument()
    }
  })

  it('打开推理开关并勾选档位后，保存时提交 reasoningLevels', () => {
    const { onSave } = renderModal()
    fireEvent.click(screen.getByRole('switch', { name: '推理' }))
    fireEvent.click(screen.getByRole('button', { name: '推理强度 高' }))

    expect(screen.getByRole('switch', { name: '推理' })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      capabilities: expect.objectContaining({
        reasoning: true,
        reasoningLevels: ['high'],
      }),
    }))
  })

  it('只勾选部分档位时按勾选结果提交', () => {
    const { onSave } = renderModal()
    fireEvent.click(screen.getByRole('switch', { name: '推理' }))
    fireEvent.click(screen.getByRole('button', { name: '推理强度 低' }))
    fireEvent.click(screen.getByRole('button', { name: '推理强度 中' }))
    fireEvent.click(screen.getByRole('button', { name: '推理强度 中' })) // 取消中

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      capabilities: expect.objectContaining({
        reasoning: true,
        reasoningLevels: ['low'],
      }),
    }))
  })

  it('推理开启但未勾选任何档位时不提交 reasoningLevels', () => {
    const { onSave } = renderModal()
    fireEvent.click(screen.getByRole('switch', { name: '推理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    const payload = onSave.mock.calls[0][0]
    expect(payload.capabilities).toEqual(expect.objectContaining({ reasoning: true }))
    expect(payload.capabilities.reasoningLevels).toBeUndefined()
  })
})

describe('addModelFormModal 表单清空', () => {
  it('关闭弹窗后重新打开，所有字段恢复默认值', () => {
    const { onSave } = renderHarness()
    fireEvent.click(screen.getByRole('button', { name: '打开' }))

    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'my-model' } })
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: '我的模型' } })
    fireEvent.click(screen.getByRole('switch', { name: '推理' }))
    fireEvent.click(screen.getByRole('button', { name: '推理强度 高' }))
    fireEvent.click(screen.getByRole('button', { name: '输入类型 图片' }))

    // 点取消关闭
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '添加模型' })).not.toBeInTheDocument()

    // 重新打开：字段应为默认值
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect(screen.getByLabelText('模型')).toHaveValue('')
    expect(screen.getByLabelText('模型名称')).toHaveValue('')
    expect(screen.getByRole('switch', { name: '推理' })).not.toBeChecked()
    expect(screen.queryByText('推理强度')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '输入类型 图片' })).toHaveAttribute('aria-pressed', 'false')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('保存成功后关闭弹窗，再次打开时字段已清空', () => {
    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'my-model' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    // 确认后父组件 onSave 关闭弹窗（与 ModelList 行为一致）
    expect(screen.queryByRole('dialog', { name: '添加模型' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect(screen.getByLabelText('模型')).toHaveValue('')
  })
})
