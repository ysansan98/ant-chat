import {
  Dialog,
  DialogClose,
  DialogContent,
} from '@workspace/ui/components/dialog'
import { cn } from '@workspace/ui/lib/utils'
import { XIcon } from 'lucide-react'
import { useState } from 'react'
import type { ImagePreviewItem } from './imagePreviewItem'
import { useAttachmentUrl } from './imagePreviewItem'

export type { ImagePreviewItem }
export { attachmentToPreviewItem } from './imagePreviewItem'

function AttachmentImg({
  item,
  className,
  ...imgProps
}: {
  item: ImagePreviewItem
  className?: string
} & Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>) {
  const src = useAttachmentUrl(item)

  if (!src) {
    return null
  }

  return (
    <img
      src={src}
      alt={item.filename || ''}
      className={className}
      {...imgProps}
    />
  )
}

export function ImageViewer({ items }: { items: ImagePreviewItem[] }) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  if (items.length === 0) {
    return null
  }

  return (
    <>
      <ImageCarousel
        items={items}
        onImageClick={(index) => {
          setPreviewIndex(index)
        }}
      />

      {/* 图片全屏预览 Dialog */}
      <Dialog
        open={previewIndex !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewIndex(null)
          }
        }}
      >
        {previewIndex !== null && (
          <style>{`
            [data-slot="dialog-overlay"] {
              animation: none !important;
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
              background: rgba(0, 0, 0, 0.85) !important;
            }
          `}</style>
        )}
        <DialogContent
          className="
            top-0! left-0! translate-x-0! translate-y-0!
            h-screen! w-screen! max-w-none! border-0 rounded-none bg-black/50 p-0
            duration-0!
          "
          showCloseButton={false}
        >
          {previewIndex !== null && (
            <ImagePreviewSlider
              items={items}
              currentIndex={previewIndex}
              onIndexChange={setPreviewIndex}
            />
          )}
          <DialogClose className="fixed top-4 right-4 z-20 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70">
            <XIcon className="size-6" />
          </DialogClose>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ============================================================================
// 水平可滚动图片缩略图组件
// ============================================================================

function ImageCarousel({
  items,
  onImageClick,
}: {
  items: ImagePreviewItem[]
  onImageClick: (index: number) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          className={cn(
            'shrink-0 overflow-hidden rounded-lg border border-border/50',
            'transition-shadow hover:shadow-md',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          onClick={() => onImageClick(index)}
        >
          <AttachmentImg
            item={item}
            className="size-20 object-contain md:size-24"
            loading="lazy"
          />
        </button>
      ))}
    </div>
  )
}

// ============================================================================
// 全屏图片预览组件（固定切换按钮位置）
// ============================================================================

function ImagePreviewSlider({
  items,
  currentIndex,
  onIndexChange,
}: {
  items: ImagePreviewItem[]
  currentIndex: number
  onIndexChange: (index: number) => void
}) {
  const item = items[currentIndex]
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < items.length - 1

  return (
    <div className="relative flex size-full items-center justify-center">
      {/* 图片区域 */}
      <div className="flex flex-col items-center gap-3">
        <AttachmentImg
          key={currentIndex}
          item={item}
          className="max-h-screen max-w-screen object-contain px-16"
          style={{ maxHeight: 'calc(100vh - 80px)' }}
        />
        <span className="text-sm text-white/60 select-none">
          {currentIndex + 1}
          /
          {items.length}
          {' '}
          —
          {' '}
          {item.filename || ''}
        </span>
      </div>

      {/* 上一张 - 固定左侧 */}
      {hasPrev && (
        <button
          type="button"
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-3 text-white transition-colors hover:bg-black/60"
          onClick={() => onIndexChange(currentIndex - 1)}
          aria-label="上一张"
        >
          <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* 下一张 - 固定右侧 */}
      {hasNext && (
        <button
          type="button"
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-3 text-white transition-colors hover:bg-black/60"
          onClick={() => onIndexChange(currentIndex + 1)}
          aria-label="下一张"
        >
          <svg className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  )
}
