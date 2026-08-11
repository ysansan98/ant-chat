import type { WorkspaceFileSearchResult } from '@ant-chat/shared'
import type { ActiveReferenceTrigger } from '../inputReferences'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReferenceSuggestionPanel } from '../ReferenceSuggestionPanel'

const fileTrigger: ActiveReferenceTrigger = { type: 'file', query: '', start: 0, end: 1 }
const file: WorkspaceFileSearchResult = { type: 'file', path: 'src/main.ts', name: 'main.ts' }
const directory: WorkspaceFileSearchResult = { type: 'directory', path: 'src', name: 'src' }

function renderPanel(highlightedIndex: number) {
  return render(
    <ReferenceSuggestionPanel
      trigger={fileTrigger}
      directories={[directory]}
      files={[file]}
      skills={[]}
      builtinCommands={[]}
      hasWorkspace
      canGoParent={false}
      highlightedIndex={highlightedIndex}
      anchorRect={new DOMRect(0, 0, 300, 40)}
      onSelectFile={() => {}}
      onSelectDirectory={() => {}}
      onSelectParent={() => {}}
      onSelectSkill={() => {}}
      onSelectCommand={() => {}}
      onSetHighlightedIndex={() => {}}
    />,
  )
}

describe('referenceSuggestionPanel 键盘高亮', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('初始 highlightedIndex=0 时第一个选项被高亮，且 cmdk 不应把它标记为 data-selected（否则高亮会被覆盖）', () => {
    renderPanel(0)

    const items = screen.getAllByRole('option')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveAttribute('data-highlighted', 'true')
    // cmdk 会在挂载时自动选中第一个 item 并设置 data-selected="true"，
    // 与自定义 data-highlighted 同时存在时，编译后顺序靠后的
    // data-[selected=true]:bg-transparent 会压过高亮样式（回归来源）。
    // 修复后 cmdk 选中态被禁用，任何 item 都不应出现 data-selected="true"。
    expect(items[0]).not.toHaveAttribute('data-selected', 'true')
    expect(items[1]).not.toHaveAttribute('data-highlighted', 'true')
  })

  it('按下方向键后高亮移动到第二个选项，且不会同时高亮两个选项', () => {
    const { rerender } = renderPanel(0)
    rerender(
      <ReferenceSuggestionPanel
        trigger={fileTrigger}
        directories={[directory]}
        files={[file]}
        skills={[]}
        builtinCommands={[]}
        hasWorkspace
        canGoParent={false}
        highlightedIndex={1}
        anchorRect={new DOMRect(0, 0, 300, 40)}
        onSelectFile={() => {}}
        onSelectDirectory={() => {}}
        onSelectParent={() => {}}
        onSelectSkill={() => {}}
        onSelectCommand={() => {}}
        onSetHighlightedIndex={() => {}}
      />,
    )

    const items = screen.getAllByRole('option')
    expect(items[1]).toHaveAttribute('data-highlighted', 'true')
    expect(items[0]).not.toHaveAttribute('data-highlighted', 'true')
    expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(1)
  })
})
