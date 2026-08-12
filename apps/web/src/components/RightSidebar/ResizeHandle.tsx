interface ResizeHandleProps {
  /** 拖拽前的初始宽度 */
  width: number
  minWidth: number
  maxWidth: number
  onWidthChange: (width: number) => void
}

/**
 * 宽度拖拽手柄（右侧栏 / 文件树列共用）。
 *
 * pointermove 期间直接修改目标元素的 DOM 宽度并临时禁用宽度过渡，
 * 不经过 React 重渲染，保证拖拽跟手；pointerup 时把最终宽度提交回状态。
 */
export function ResizeHandle({ width, minWidth, maxWidth, onWidthChange }: ResizeHandleProps) {
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.currentTarget.parentElement
    if (!target) {
      return
    }
    const startX = event.clientX
    const startWidth = width
    target.style.transition = 'none'
    const move = (next: PointerEvent) => {
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + startX - next.clientX))
      target.style.width = `${nextWidth}px`
    }
    const finish = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', finish)
      document.body.style.userSelect = ''
      target.style.transition = ''
      onWidthChange(target.getBoundingClientRect().width)
    }
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', finish)
  }

  return <div className="absolute inset-y-0 -left-1 z-10 w-2 cursor-ew-resize hover:bg-primary/20" onPointerDown={handlePointerDown} />
}
