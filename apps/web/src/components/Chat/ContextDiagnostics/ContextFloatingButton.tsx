import { Layers } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

// ================================================================
// ContextFloatingButton — 模型上下文面板的浮层触发按钮
//
// 以浮层形式悬浮在对话区，可拖拽移动位置（位置持久化到 localStorage），
// 点击打开上下文面板。面板打开时该按钮隐藏，避免与面板重叠。
// ================================================================

const STORAGE_KEY = 'ant-chat:context-fab-pos'
const MARGIN = 20
const BUTTON_SIZE = 44
const DRAG_THRESHOLD = 4

export interface ContextFloatingButtonProps {
  /** 拖拽边界容器（对话区根节点），按钮位置相对其计算 */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 点击（非拖拽）时打开面板 */
  onOpen: () => void
}

export function ContextFloatingButton({ containerRef, onOpen }: ContextFloatingButtonProps) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<{ pointerId: number, startX: number, startY: number, baseX: number, baseY: number, moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  // 从 localStorage 惰性恢复上次位置；无记录时为 null，由 CSS 落到右下角留边
  const [pos, setPos] = useState<{ x: number, y: number } | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const p = JSON.parse(saved) as { x: number, y: number }
        if (Number.isFinite(p.x) && Number.isFinite(p.y))
          return p
      }
      catch {
        // 解析失败则回退到默认右下角
      }
    }
    return null
  })

  const clamp = useCallback((x: number, y: number) => {
    const container = containerRef.current
    const btn = btnRef.current
    if (!container || !btn)
      return { x, y }
    const maxX = Math.max(0, container.clientWidth - btn.offsetWidth)
    const maxY = Math.max(0, container.clientHeight - btn.offsetHeight)
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    }
  }, [containerRef])

  // 当 pos 为空（CSS 定位在右下角）时，从按钮实际位置反推容器内坐标作为拖拽基准
  const computeBasePos = useCallback((): { x: number, y: number } => {
    const container = containerRef.current
    const btn = btnRef.current
    if (!container || !btn) {
      return {
        x: Math.max(MARGIN, window.innerWidth - BUTTON_SIZE - MARGIN),
        y: Math.max(MARGIN, window.innerHeight - BUTTON_SIZE - MARGIN),
      }
    }
    const cRect = container.getBoundingClientRect()
    const bRect = btn.getBoundingClientRect()
    return { x: bRect.left - cRect.left, y: bRect.top - cRect.top }
  }, [containerRef])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    // 优先用已保存/计算过的位置；pos 为空时按当前实际位置推导（事件回调内 setState，不触发规则）
    const base = pos ?? computeBasePos()
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: base.x,
      baseY: base.y,
      moved: false,
    }
    if (!pos)
      setPos(base)
    btnRef.current?.setPointerCapture(e.pointerId)
  }, [pos, computeBasePos])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d)
      return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD)
      d.moved = true
    if (d.moved)
      setPos(clamp(d.baseX + dx, d.baseY + dy))
  }, [clamp])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d)
      return
    dragRef.current = null
    btnRef.current?.releasePointerCapture(e.pointerId)
    if (d.moved) {
      // 拖拽结束后抑制紧随其后的 click，避免误触发打开
      suppressClickRef.current = true
      setPos((p) => {
        if (p)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
        return p
      })
    }
  }, [])

  const handleClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    onOpen()
  }, [onOpen])

  const style: React.CSSProperties = pos
    ? { position: 'absolute', left: pos.x, top: pos.y, touchAction: 'none' }
    : { position: 'absolute', right: MARGIN, bottom: MARGIN, touchAction: 'none' }

  return (
    <button
      ref={btnRef}
      type="button"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={handleClick}
      className="z-30 flex size-11 cursor-grab items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-lg shadow-black/10 transition-colors hover:bg-accent/10 active:cursor-grabbing"
      aria-label="打开模型上下文面板"
      title="模型上下文（拖拽移动位置）"
    >
      <Layers className="size-5" />
    </button>
  )
}
