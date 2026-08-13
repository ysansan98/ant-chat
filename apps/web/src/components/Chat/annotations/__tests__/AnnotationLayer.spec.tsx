import type { AnnotationDraft } from '../annotationDraft'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnotationLayer } from '../AnnotationLayer'

const FAKE_RECT = {
  left: 100,
  right: 120,
  top: 50,
  bottom: 60,
  width: 20,
  height: 10,
  x: 100,
  y: 50,
  toJSON: () => ({}),
} as DOMRect

function createDraft(overrides: Partial<AnnotationDraft> = {}): AnnotationDraft {
  return {
    id: 'a1',
    stepId: 'step-1',
    targetMessageId: 'msg-target',
    quote: 'hello',
    comment: '',
    start: 0,
    end: 5,
    ...overrides,
  }
}

function createRangeIn(container: HTMLElement, start: number, end: number): Range {
  const textNode = container.querySelector('div')!.firstChild!
  const range = document.createRange()
  range.setStart(textNode, start)
  range.setEnd(textNode, end)
  return range
}

function mockSelection(range: Range | null) {
  const selection = {
    isCollapsed: range === null,
    rangeCount: range ? 1 : 0,
    getRangeAt: () => range,
    removeAllRanges: vi.fn(),
  }
  return vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection)
}

function renderLayer(props: {
  enabled?: boolean
  drafts?: AnnotationDraft[]
  activeId?: string | null
  onAdd?: (draft: Omit<AnnotationDraft, 'id'>) => void
  onUpdate?: (id: string, comment: string) => void
  onRemove?: (id: string) => void
  onActivate?: (id: string | null) => void
  editingDraftId?: string | null
  onDraftEditConsumed?: () => void
}) {
  const {
    enabled = true,
    drafts = [],
    activeId = null,
    onAdd = vi.fn(),
    onUpdate = vi.fn(),
    onRemove = vi.fn(),
    onActivate = vi.fn(),
    editingDraftId = null,
    onDraftEditConsumed = vi.fn(),
  } = props
  const utils = render(
    <AnnotationLayer
      stepId="step-1"
      text="hello world"
      enabled={enabled}
      drafts={drafts}
      activeId={activeId}
      onAdd={onAdd}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onActivate={onActivate}
      editingDraftId={editingDraftId}
      onDraftEditConsumed={onDraftEditConsumed}
    >
      <div>hello world</div>
    </AnnotationLayer>,
  )
  return {
    ...utils,
    container: utils.container.querySelector('[data-annotation-step="step-1"]') as HTMLElement,
    onAdd,
    onUpdate,
    onRemove,
    onActivate,
  }
}

describe('annotationLayer 批注编辑态', () => {
  beforeEach(() => {
    // jsdom 未实现 Range.getClientRects，用 defineProperty 补系统边界能力
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [FAKE_RECT],
    })
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => FAKE_RECT,
    })
  })

  afterEach(() => {
    delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects
    delete (Range.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect
    vi.restoreAllMocks()
  })

  function selectText(container: HTMLElement, start: number, end: number, target: HTMLElement = container) {
    mockSelection(createRangeIn(container, start, end))
    fireEvent.mouseUp(target)
  }

  function openComposer(container: HTMLElement) {
    selectText(container, 0, 5)
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: '添加批注' }))
  }

  function saveWithEnter() {
    fireEvent.keyDown(screen.getByLabelText('评论内容'), { key: 'Enter' })
  }

  it('在终态消息上选中文本后出现横向菜单，不直接打开批注弹窗', () => {
    const { container } = renderLayer({})
    selectText(container, 0, 5)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '添加批注' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('点击添加批注后打开批注弹窗', () => {
    const { container } = renderLayer({})
    selectText(container, 0, 5)
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: '添加批注' }))
    expect(screen.getByRole('dialog', { name: '添加批注' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // 打开即聚焦输入框，并保留选中内容的高亮（不依赖浏览器原生选区）
    expect(screen.getByLabelText('评论内容')).toHaveFocus()
    expect(container.querySelector('mark[data-annotation-highlight]')?.textContent).toBe('hello')
  })

  it('创建模式只有输入框，按 Enter 后按选区偏移调用 onAdd', () => {
    const { container, onAdd } = renderLayer({})
    openComposer(container)
    // 创建模式不展示保存/取消按钮
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: '这段要改' } })
    saveWithEnter()
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      stepId: 'step-1',
      targetMessageId: 'step-1',
      quote: 'hello',
      comment: '这段要改',
      start: 0,
      end: 5,
    }))
  })

  it('保存后浮层关闭并清除激活状态', () => {
    const { container, onActivate } = renderLayer({})
    openComposer(container)
    saveWithEnter()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onActivate).toHaveBeenCalledWith(null)
  })

  it('shift+Enter 不触发保存（换行）', () => {
    const { container, onAdd } = renderLayer({})
    openComposer(container)
    fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: '第一行' } })
    fireEvent.keyDown(screen.getByLabelText('评论内容'), { key: 'Enter', shiftKey: true })
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('点击浮层外部关闭批注弹窗', () => {
    const { container } = renderLayer({})
    openComposer(container)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('存在批注时显示序号气泡，点击后复现高亮并打开编辑浮层', () => {
    const draft = createDraft()
    const onActivate = vi.fn()
    const utils = renderLayer({ drafts: [draft], onActivate })
    fireEvent.click(screen.getByRole('button', { name: '批注 1' }))
    expect(onActivate).toHaveBeenCalledWith('a1')
    // 父级收到激活回调后重渲染，激活态生效
    utils.rerender(
      <AnnotationLayer
        stepId="step-1"
        text="hello world"
        enabled
        drafts={[draft]}
        activeId="a1"
        onAdd={vi.fn()}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onActivate={vi.fn()}
        editingDraftId={null}
        onDraftEditConsumed={vi.fn()}
      >
        <div>hello world</div>
      </AnnotationLayer>,
    )
    const container = utils.container as HTMLElement
    expect(screen.getByRole('dialog', { name: '编辑批注' })).toBeInTheDocument()
    expect(screen.getByLabelText('评论内容')).toHaveValue('')
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
    expect(container.querySelector('mark[data-annotation-highlight]')?.textContent).toBe('hello')
  })

  it('编辑浮层展示原评论，保存后调用 onUpdate', () => {
    const draft = createDraft({ comment: '原评论' })
    const onUpdate = vi.fn()
    renderLayer({ drafts: [draft], activeId: 'a1', onUpdate })
    fireEvent.click(screen.getByRole('button', { name: '批注 1' }))
    expect(screen.getByLabelText('评论内容')).toHaveValue('原评论')
    fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: '新评论' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onUpdate).toHaveBeenCalledWith('a1', '新评论')
  })

  it('删除批注时调用 onRemove 并关闭浮层', () => {
    const draft = createDraft()
    const onRemove = vi.fn()
    renderLayer({ drafts: [draft], activeId: 'a1', onRemove })
    fireEvent.click(screen.getByRole('button', { name: '批注 1' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(onRemove).toHaveBeenCalledWith('a1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('多个批注按添加顺序编号', () => {
    const drafts = [
      createDraft({ id: 'a1', start: 0, end: 5 }),
      createDraft({ id: 'a2', start: 6, end: 11, quote: 'world' }),
    ]
    renderLayer({ drafts })
    expect(screen.getByRole('button', { name: '批注 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '批注 2' })).toBeInTheDocument()
  })

  it('流式（enabled=false）时选中文本不出现浮层', () => {
    const { container } = renderLayer({ enabled: false })
    selectText(container, 0, 5)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('选区跨出容器时不创建批注', () => {
    const { container } = renderLayer({})
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    const textNode = outside.appendChild(document.createTextNode('outside text'))
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 5)
    mockSelection(range)
    fireEvent.mouseUp(container)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('空白选区不创建批注', () => {
    const { container } = renderLayer({})
    const textNode = container.querySelector('div')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 5)
    range.setEnd(textNode, 5)
    mockSelection(range)
    fireEvent.mouseUp(container)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('从容器外开始拖选容器内文本也能创建批注（气泡留白处开始拖）', () => {
    const { container } = renderLayer({})
    // mouseup 落在容器外（气泡留白/滚动条），选区仍在容器内
    selectText(container, 0, 5, document.body)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('菜单打开且选区未变化时，再次 mouseup 不重置菜单', () => {
    const { container, onAdd } = renderLayer({})
    selectText(container, 0, 5)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    // 同一选区再次 mouseup（点击他处残留选区）：菜单保持，不重复打开
    fireEvent.mouseUp(container)
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('点击菜单外部关闭横向菜单', () => {
    const { container } = renderLayer({})
    selectText(container, 0, 5)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('选区边界落在元素节点上时仍能创建批注（真实拖拽常见形态）', () => {
    const { container, onAdd } = renderLayer({})
    const element = container.querySelector('div')!
    const range = document.createRange()
    range.setStart(element, 0)
    range.setEnd(element, 1)
    mockSelection(range)
    fireEvent.mouseUp(container)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: '添加批注' }))
    fireEvent.change(screen.getByLabelText('评论内容'), { target: { value: '整段' } })
    saveWithEnter()
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      quote: 'hello world',
      start: 0,
      end: 11,
    }))
  })

  it('sender 草稿编辑请求匹配本 step 时打开编辑浮层并消费请求', () => {
    const draft = createDraft({ comment: '草稿评论' })
    const onConsumed = vi.fn()
    renderLayer({ drafts: [draft], editingDraftId: 'a1', onDraftEditConsumed: onConsumed })
    expect(screen.getByRole('dialog', { name: '编辑批注' })).toBeInTheDocument()
    expect(screen.getByLabelText('评论内容')).toHaveValue('草稿评论')
    expect(onConsumed).toHaveBeenCalled()
  })
})
