import { Button } from '@workspace/ui/components/button'
import {
  MaximizeIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

interface ImagePreviewProps {
  url: string
  fileName: string
}

const MIN_SCALE = 0.2
const MAX_SCALE = 8
const SCALE_STEP = 0.2

/**
 * 图片预览：支持放大/缩小（按钮 + 滚轮）、左右旋转 90°、重置、鼠标拖拽平移。
 * 变换通过 CSS transform（translate + rotate + scale）实现，无第三方依赖。
 */
export function ImagePreview({ url, fileName }: ImagePreviewProps) {
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const draggingRef = useRef<{ startX: number, startY: number, baseX: number, baseY: number } | null>(null)

  const zoomIn = useCallback(() => setScale(s => Math.min(MAX_SCALE, Number((s + SCALE_STEP).toFixed(2)))), [])
  const zoomOut = useCallback(() => setScale(s => Math.max(MIN_SCALE, Number((s - SCALE_STEP).toFixed(2)))), [])
  const rotateCw = useCallback(() => setRotation(r => r + 90), [])
  const rotateCcw = useCallback(() => setRotation(r => r - 90), [])
  const reset = useCallback(() => {
    setScale(1)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }, [])

  const onWheel = useCallback((event: React.WheelEvent) => {
    const delta = event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP
    setScale(s => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((s + delta).toFixed(2)))))
  }, [])

  const onMouseDown = useCallback((event: React.MouseEvent) => {
    draggingRef.current = { startX: event.clientX, startY: event.clientY, baseX: offset.x, baseY: offset.y }
  }, [offset])

  const onMouseMove = useCallback((event: React.MouseEvent) => {
    const drag = draggingRef.current
    if (!drag) {
      return
    }
    setOffset({ x: drag.baseX + (event.clientX - drag.startX), y: drag.baseY + (event.clientY - drag.startY) })
  }, [])

  const endDrag = useCallback(() => {
    draggingRef.current = null
  }, [])

  const transform = `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${scale})`
  const isReset = scale === 1 && rotation === 0 && offset.x === 0 && offset.y === 0

  return (
    <div className="flex h-full flex-col bg-neutral-900/95" data-testid="image-preview">
      <div className="flex shrink-0 items-center justify-center gap-1 border-b border-white/10 px-2 py-1.5">
        <ToolbarButton label="缩小" onClick={zoomOut} disabled={scale <= MIN_SCALE}>
          <ZoomOutIcon className="size-4" />
        </ToolbarButton>
        <span className="w-12 text-center text-xs text-white/70 tabular-nums">
          {Math.round(scale * 100)}
          %
        </span>
        <ToolbarButton label="放大" onClick={zoomIn} disabled={scale >= MAX_SCALE}>
          <ZoomInIcon className="size-4" />
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-white/15" />
        <ToolbarButton label="逆时针旋转" onClick={rotateCcw}>
          <RotateCcwIcon className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="顺时针旋转" onClick={rotateCw}>
          <RotateCwIcon className="size-4" />
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-white/15" />
        <ToolbarButton label="重置" onClick={reset} disabled={isReset}>
          <MaximizeIcon className="size-4" />
        </ToolbarButton>
      </div>

      <div
        className="relative flex min-h-0 flex-1 cursor-grab items-center justify-center overflow-hidden active:cursor-grabbing"
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onDoubleClick={reset}
      >
        <img
          src={url}
          alt={fileName}
          draggable={false}
          className="max-h-full max-w-full object-contain transition-transform duration-100 ease-out select-none"
          style={{ transform }}
        />
      </div>
    </div>
  )
}

function ToolbarButton({ label, onClick, disabled, children }: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  )
}
