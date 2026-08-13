import type { CSSProperties, ReactNode } from 'react'
import type { AnnotationDraft } from './annotationDraft'
import type { TextNodeEntry, TextNodeMap } from './textAnchor'
import { cn } from '@workspace/ui/lib/utils'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { extractTargetMessageId } from './annotationDraft'
import { AnnotationPopover } from './AnnotationPopover'
import {
  applyHighlight,
  buildTextNodeMap,
  clearHighlights,
  resolveRange,
} from './textAnchor'

/** 一次选区的内容与两个浮层位置（横向菜单 + 批注弹窗），创建流程共用。 */
interface SelectionState {
  start: number
  end: number
  quote: string
  /** 横向菜单锚点（选区上方居中，空间不足时翻转到下方） */
  menuX: number
  menuY: number
  menuFlip: boolean
  /** 批注弹窗锚点（选区上方，空间不足时翻转到下方） */
  popoverX: number
  popoverY: number
  popoverFlip: boolean
}

interface EditorState {
  id: string
  x: number
  y: number
  flip: boolean
}

const MENU_WIDTH = 80
const MENU_HEIGHT = 30
const MENU_GAP = 2
/** 批注弹窗与选区的间距；高度估算用于上方空间不足时的翻转判定 */
const POPOVER_GAP = 8
const POPOVER_HEIGHT_ESTIMATE = 180

interface AnnotationLayerProps {
  /** turnSteps 生成的 text step id，批注归属单元 */
  stepId: string
  /** step 原始文本（依赖变更触发重定位/重应用高亮） */
  text: string
  /** 消息处于终态且 turn 空闲时才允许批注（流式中禁用） */
  enabled: boolean
  /** 全部批注（含其他 step，用于全局序号） */
  drafts: AnnotationDraft[]
  activeId: string | null
  onAdd: (draft: Omit<AnnotationDraft, 'id'>) => void
  onUpdate: (id: string, comment: string) => void
  onRemove: (id: string) => void
  onActivate: (id: string | null) => void
  /** Sender 预览发起的草稿原位编辑请求（匹配本 step 时打开编辑浮层） */
  editingDraftId: string | null
  onDraftEditConsumed: () => void
  children: ReactNode
}

/** 选区边界是否完全落在容器内（跨出容器/跨 step 的选区不参与批注）。 */
function isRangeWithinContainer(range: Range, container: HTMLElement): boolean {
  return (
    container.contains(range.startContainer)
    && container.contains(range.endContainer)
    && container.contains(range.commonAncestorContainer)
  )
}

/** 向上查找最近的纵向可滚动祖先（消息滚动容器），用于把引用文字滚动到可视区。 */
function findScrollableAncestor(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement
  while (current) {
    if (current.scrollHeight > current.clientHeight) {
      return current
    }
    current = current.parentElement
  }
  return null
}

/** 元素边界内第一个/最后一个文本条目（元素内无文本时返回 null）。 */
function firstEntryInside(map: TextNodeMap, node: Node): TextNodeEntry | null {
  for (const entry of map.entries) {
    if (node.contains(entry.node)) {
      return entry
    }
  }
  return null
}

function lastEntryInside(map: TextNodeMap, node: Node): TextNodeEntry | null {
  for (let index = map.entries.length - 1; index >= 0; index--) {
    if (node.contains(map.entries[index].node)) {
      return map.entries[index]
    }
  }
  return null
}

/**
 * 把 DOM 节点/偏移换算为映射文本偏移。
 * 真实拖拽的选区边界经常落在元素节点上（从行首空白开始、跨内联元素/块级元素），
 * 不能静默拒绝：起点取元素内首个文本条目起点，终点取最后一个条目终点。
 */
function offsetForNode(map: TextNodeMap, node: Node, offset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    for (const entry of map.entries) {
      if (entry.node === node) {
        return entry.start + offset
      }
    }
    return null
  }
  const entry = offset === 0 ? firstEntryInside(map, node) : lastEntryInside(map, node)
  return entry ? (offset === 0 ? entry.start : entry.end) : null
}

/**
 * 单个文本 step 的批注编辑层：选区捕获、序号气泡、点击复现高亮、创建/编辑浮层。
 * 所有批注状态由父级持有（发送前临时状态），本组件只负责与 DOM 选区/渲染交互。
 */
export function AnnotationLayer({
  stepId,
  text,
  enabled,
  drafts,
  activeId,
  onAdd,
  onUpdate,
  onRemove,
  onActivate,
  editingDraftId,
  onDraftEditConsumed,
  children,
}: AnnotationLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<SelectionState | null>(null)
  const [composer, setComposer] = useState<SelectionState | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [badgePositions, setBadgePositions] = useState<Record<string, { x: number, y: number }>>({})
  /** 编辑浮层打开时间：打开后的短窗口内滚动（编辑流程的自动滚动）不应关闭浮层 */
  const editorOpenedAtRef = useRef(0)
  const hasPopover = menu !== null || composer !== null || editor !== null
  /** 当前菜单/弹窗对应的选区，用于区分"重新选中"与"点击他处但选区残留" */
  const selectionRef = useRef<SelectionState | null>(null)

  const stepDrafts = drafts.filter(draft => draft.stepId === stepId)
  const activeDraft = activeId ? drafts.find(draft => draft.id === activeId) : undefined
  // 高亮目标：编辑态点击气泡复现的批注区间，或创建态当前选中的区间。
  // 创建态也包 mark：打开弹窗会 focus 输入框并清掉浏览器原生选区，
  // 用户必须能持续看到刚才选中的内容
  const highlightTarget = useMemo(
    () => activeDraft
      ? { start: activeDraft.start, end: activeDraft.end }
      : composer
        ? { start: composer.start, end: composer.end }
        : null,
    [activeDraft, composer],
  )

  // 点击序号气泡复现选中态：把 active 批注的区间重新包成高亮 <mark>
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    clearHighlights(container)
    if (!highlightTarget) {
      return
    }
    const map = buildTextNodeMap(container)
    applyHighlight(container, map, highlightTarget.start, highlightTarget.end)
  }, [highlightTarget])

  // 序号气泡定位：取选中内容首行右上角（相对容器的坐标，滚动时随容器移动）
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const ownDrafts = drafts.filter(draft => draft.stepId === stepId)
    if (ownDrafts.length === 0) {
      setBadgePositions({})
      return
    }
    const map = buildTextNodeMap(container)
    const containerRect = container.getBoundingClientRect()
    const next: Record<string, { x: number, y: number }> = {}
    ownDrafts.forEach((draft, index) => {
      const range = resolveRange(map, draft.start, draft.end)
      const rect = range?.getClientRects()[0]
      if (!range || !rect) {
        return
      }
      next[draft.id] = {
        // 同一位置多个批注时按序错开，避免气泡互相覆盖
        // clamp 到容器内：首行文字靠近容器边缘时，气泡超出部分会被父级
        // overflow-hidden 裁剪（表现为"被两边截断"）
        x: Math.min(rect.right - containerRect.left + index * 12, containerRect.width - 12),
        y: Math.max(8, Math.min(rect.top - containerRect.top, containerRect.height - 20)),
      }
    })
    setBadgePositions(next)
  }, [drafts, stepId, text])

  // 浮层打开期间滚动/缩放导致锚点失效，直接关闭
  useEffect(() => {
    if (!hasPopover) {
      return
    }
    const close = () => {
      setMenu(null)
      setComposer(null)
      // 编辑浮层打开后的自动滚动窗口（如 sender 编辑触发的定位滚动）不关闭浮层；
      // 用户随后主动滚动列表时仍会关闭
      if (editor && Date.now() - editorOpenedAtRef.current < 800) {
        return
      }
      setEditor(null)
    }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [editor, hasPopover])

  // 用 document 级 capture 监听选中结束：真实拖拽的 mouseup 可能落在容器外
  // （拖出边界/滚动条），React 冒泡 onMouseUp 会漏掉；capture 阶段先于任何
  // stopPropagation 执行。拖拽起点不设限——用户常从气泡留白处开始拖，mousedown
  // 的 target 并不在容器内；通过"选区未变化不重开菜单"防点击他处的误触发。
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const handleMouseUp = (event: MouseEvent) => {
      if (!enabled) {
        return
      }
      // 点击序号气泡/菜单/浮层按钮时忽略，避免误开或重置创建浮层
      const target = event.target as HTMLElement | null
      if (
        target?.closest('[data-annotation-badge]')
        || target?.closest('[data-annotation-menu]')
        || target?.closest('[role=dialog]')
      ) {
        return
      }
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return
      }
      const range = selection.getRangeAt(0)
      if (!isRangeWithinContainer(range, container) || range.toString().trim().length === 0) {
        return
      }
      const map = buildTextNodeMap(container)
      const start = offsetForNode(map, range.startContainer, range.startOffset)
      const end = offsetForNode(map, range.endContainer, range.endOffset)
      if (start === null || end === null || end <= start) {
        return
      }
      const quote = map.text.slice(start, end)
      if (!quote.trim()) {
        return
      }
      // 菜单/弹窗已打开且选区与当前完全一致：点击他处残留选区不应重开
      const current = selectionRef.current
      if (current && current.start === start && current.end === end) {
        return
      }
      const rects = range.getClientRects()
      const first = rects[0] ?? range.getBoundingClientRect()
      const last = rects[rects.length - 1] ?? first
      const menuFlip = first.top - MENU_HEIGHT - MENU_GAP < 8
      const menuY = menuFlip ? last.bottom + MENU_GAP : first.top - MENU_HEIGHT - MENU_GAP
      const menuX = Math.max(
        8,
        Math.min(first.left + first.width / 2 - MENU_WIDTH / 2, window.innerWidth - MENU_WIDTH - 8),
      )
      // 弹窗底边贴选区上方；上方空间不足（弹窗会超出视口顶部）时翻转到选区下方
      const popoverFlip = first.top - POPOVER_HEIGHT_ESTIMATE - POPOVER_GAP < 8
      const popoverY = popoverFlip
        ? last.bottom + POPOVER_GAP
        : first.top - POPOVER_GAP
      const popoverX = Math.max(8, Math.min(last.right, window.innerWidth - 288 - 8))
      onActivate(null)
      setEditor(null)
      setMenu({
        start,
        end,
        quote,
        menuX,
        menuY,
        menuFlip,
        popoverX,
        popoverY,
        popoverFlip,
      })
    }
    document.addEventListener('mouseup', handleMouseUp, true)
    return () => {
      document.removeEventListener('mouseup', handleMouseUp, true)
    }
  }, [enabled, onActivate])

  useEffect(() => {
    selectionRef.current = menu ?? composer
  }, [menu, composer])

  // Sender 预览的草稿编辑请求：匹配本 step 的草稿后用其保存的偏移定位并打开编辑浮层
  useEffect(() => {
    if (!editingDraftId) {
      return
    }
    const draft = drafts.find(item => item.id === editingDraftId && item.stepId === stepId)
    if (!draft) {
      return
    }
    const container = containerRef.current
    if (!container) {
      return
    }
    const map = buildTextNodeMap(container)
    const range = resolveRange(map, draft.start, draft.end)
    let rect = range?.getClientRects()[0]
    if (rect && (rect.top < 0 || rect.top > window.innerHeight - 120)) {
      // 引用文字不在视口内：消息级跳转只定位到整条消息，这里把文字精确滚动到
      // 滚动容器可视区中央（auto 同步完成），再读取滚动后的坐标定位浮层
      const scroller = findScrollableAncestor(container)
      if (scroller) {
        const scrollerRect = scroller.getBoundingClientRect()
        scroller.scrollTo({
          top: Math.max(0, scroller.scrollTop + rect.top - scrollerRect.top - scroller.clientHeight / 2),
          behavior: 'auto',
        })
        rect = range?.getClientRects()[0]
      }
    }
    // 定位兜底：引用文本不存在或不在视口内时，退化为容器左上角
    if (!rect || rect.top < 0 || rect.top > window.innerHeight - 120) {
      const containerRect = container.getBoundingClientRect()
      setEditor({ id: draft.id, x: containerRect.left + 8, y: containerRect.top - POPOVER_GAP, flip: false })
      editorOpenedAtRef.current = Date.now()
    }
    else {
      const flip = rect.top - POPOVER_HEIGHT_ESTIMATE - POPOVER_GAP < 8
      setEditor({
        id: draft.id,
        x: Math.max(8, Math.min(rect.right, window.innerWidth - 288 - 8)),
        y: flip ? rect.bottom + POPOVER_GAP : rect.top - POPOVER_GAP,
        flip,
      })
      editorOpenedAtRef.current = Date.now()
      onActivate(draft.id)
    }
    onDraftEditConsumed()
  }, [editingDraftId, drafts, stepId, onActivate, onDraftEditConsumed])

  // 点击菜单外部关闭横向菜单（菜单自身/浮层/气泡上的点击除外）
  useEffect(() => {
    if (!menu) {
      return
    }
    const closeMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target?.closest('[data-annotation-menu]')
        || target?.closest('[role=dialog]')
        || target?.closest('[data-annotation-badge]')
      ) {
        return
      }
      setMenu(null)
    }
    document.addEventListener('mousedown', closeMenu, true)
    return () => document.removeEventListener('mousedown', closeMenu, true)
  }, [menu])

  const handleBadgeClick = (draft: AnnotationDraft) => {
    const container = containerRef.current
    const pos = badgePositions[draft.id]
    const containerRect = container?.getBoundingClientRect()
    const nextActive = activeId === draft.id ? null : draft.id
    onActivate(nextActive)
    setMenu(null)
    if (!pos || !containerRect) {
      setEditor(null)
      return
    }
    // 编辑浮层 fixed 定位需要 viewport 坐标：容器坐标 + 容器偏移；
    // 浮层底边贴气泡上方，空间不足时翻转到下方
    const badgeY = containerRect.top + pos.y
    const flip = badgeY - POPOVER_HEIGHT_ESTIMATE - POPOVER_GAP < 8
    setEditor({
      id: draft.id,
      x: containerRect.left + pos.x,
      y: flip ? badgeY + POPOVER_GAP : badgeY - POPOVER_GAP,
      flip,
    })
    editorOpenedAtRef.current = Date.now()
  }

  const closePopover = useCallback(() => {
    setMenu(null)
    setComposer(null)
    setEditor(null)
    onActivate(null)
    window.getSelection()?.removeAllRanges()
  }, [onActivate])

  // 点击浮层外部关闭批注弹窗（输入框自身、气泡上的点击除外）
  useEffect(() => {
    if (!composer && !editor) {
      return
    }
    const closePopoverOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target?.closest('[role=dialog]')
        || target?.closest('[data-annotation-badge]')
        || target?.closest('[data-annotation-menu]')
      ) {
        return
      }
      closePopover()
    }
    document.addEventListener('mousedown', closePopoverOnOutsideClick, true)
    return () => document.removeEventListener('mousedown', closePopoverOnOutsideClick, true)
  }, [closePopover, composer, editor])

  return (
    <div
      ref={containerRef}
      data-annotation-step={stepId}
      className="relative"
    >
      {children}
      {stepDrafts.map((draft) => {
        const globalIndex = drafts.findIndex(item => item.id === draft.id)
        const pos = badgePositions[draft.id]
        if (globalIndex < 0 || !pos) {
          return null
        }
        const isActive = draft.id === activeId
        return (
          <button
            key={draft.id}
            type="button"
            data-annotation-badge={draft.id}
            aria-label={`批注 ${globalIndex + 1}`}
            className={cn(
              'absolute z-10 flex size-4 -translate-1/2 items-center justify-center rounded-full text-[11px] font-medium transition-colors',
              'top-(--annotation-badge-y) left-(--annotation-badge-x)',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-primary/80 text-primary-foreground hover:bg-primary',
            )}
            style={{
              '--annotation-badge-x': `${pos.x}px`,
              '--annotation-badge-y': `${pos.y}px`,
            } as CSSProperties}
            onClick={() => handleBadgeClick(draft)}
          >
            {globalIndex + 1}
          </button>
        )
      })}
      {menu && (
        <div
          data-annotation-menu="true"
          role="menu"
          className="fixed top-(--annotation-menu-y) left-(--annotation-menu-x) z-50 flex items-center rounded-md border border-border bg-popover p-0.5 shadow-md"
          style={{
            '--annotation-menu-x': `${menu.menuX}px`,
            '--annotation-menu-y': `${menu.menuY}px`,
          } as CSSProperties}
        >
          <button
            type="button"
            role="menuitem"
            className="rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent"
            // 用 mousedown 立即响应：click 依赖 mousedown/mouseup 落在同一元素上，
            // 菜单可能在两者之间被滚动/外部点击卸载，导致点击丢失
            onMouseDown={() => {
              setComposer(menu)
              setMenu(null)
            }}
          >
            添加批注
          </button>
        </div>
      )}
      {(composer || editor) && (() => {
        const editingDraft = editor ? drafts.find(draft => draft.id === editor.id) : undefined
        return (
          <AnnotationPopover
            mode={editor ? 'edit' : 'create'}
            initialComment={editor ? editingDraft?.comment ?? '' : ''}
            x={editor ? editor.x : composer!.popoverX}
            y={editor ? editor.y : composer!.popoverY}
            flip={editor ? editor.flip : composer!.popoverFlip}
            onSave={(comment) => {
              if (editor && editingDraft) {
                onUpdate(editingDraft.id, comment)
              }
              else if (composer) {
                onAdd({
                  stepId,
                  targetMessageId: extractTargetMessageId(stepId),
                  quote: composer.quote,
                  comment,
                  start: composer.start,
                  end: composer.end,
                })
              }
              closePopover()
            }}
            onDelete={editor && editingDraft
              ? () => {
                  onRemove(editingDraft.id)
                  closePopover()
                }
              : undefined}
            onCancel={closePopover}
          />
        )
      })()}
    </div>
  )
}
