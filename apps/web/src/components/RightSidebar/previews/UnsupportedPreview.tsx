import { EmptyState } from '@workspace/ui/components/empty-state'
import { FileTypeIcon } from 'lucide-react'

interface UnsupportedPreviewProps {
  /** 主标题；默认「该文件类型暂不支持预览」 */
  title?: string
  /** 副文案；默认「可用系统默认软件打开查看」 */
  description?: string
}

/**
 * 无法以内置方式预览的文件类型占位（二进制 / 超过大小上限等）：
 * 中性提示（非错误态），优先于文件读取/大小判断展示。
 */
export function UnsupportedPreview({
  title = '该文件类型暂不支持预览',
  description = '可用系统默认软件打开查看',
}: UnsupportedPreviewProps) {
  return (
    <div className="flex h-full items-center justify-center p-6" data-testid="unsupported-preview">
      <EmptyState
        icon={<FileTypeIcon className="size-6" />}
        title={title}
        description={description}
      />
    </div>
  )
}
