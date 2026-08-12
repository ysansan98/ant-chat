import { ReactDocxViewer } from '@extend-ai/react-docx'
import { Spinner } from '@workspace/ui/components/spinner'
import { AlertCircleIcon, FileTextIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { initPreviewWasm } from './wasmConfig'

interface DocxPreviewProps {
  url: string
  fileName: string
}

/**
 * DOCX 预览：基于 @extend-ai/react-docx（Rust/WASM 解析）。
 * ReactDocxViewer 只接受 ArrayBuffer，需先 fetch 流式 URL 获取。
 * 支持分页、页眉页脚、表格、图片、标题、列表等完整 Word 文档结构。
 */
export function DocxPreview({ url, fileName }: DocxPreviewProps) {
  const [buffer, setBuffer] = useState<ArrayBuffer | undefined>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    void (async () => {
      try {
        initPreviewWasm()
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`加载失败：HTTP ${res.status}`)
        }
        const buf = await res.arrayBuffer()
        if (cancelled) {
          return
        }
        setBuffer(buf)
        setLoading(false)
      }
      catch (cause) {
        if (cancelled) {
          return
        }
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [url])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="docx-preview-loading">
        <Spinner />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center" data-testid="docx-preview-error">
        <AlertCircleIcon className="size-8 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (!buffer) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6" data-testid="docx-preview-empty">
        <FileTextIcon className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">没有可显示的内容</p>
      </div>
    )
  }

  return (
    <div className="size-full overflow-auto bg-muted/30" data-testid="docx-preview">
      <ReactDocxViewer
        file={buffer}
        emptyState={`「${fileName}」文档为空或无法解析`}
      />
    </div>
  )
}
