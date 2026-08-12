import type { CSSProperties } from 'react'
import { PDFViewer } from '@embedpdf/react-pdf-viewer'
import { AlertCircleIcon } from 'lucide-react'
import { useState } from 'react'

interface PdfPreviewProps {
  url: string
  fileName: string
}

/**
 * PDF 预览：基于 @embedpdf/react-pdf-viewer（PDFium WASM 引擎）。
 * 支持页码导航、缩放、旋转、搜索、缩略图、文本选择。
 */
export function PdfPreview({ url }: PdfPreviewProps) {
  const [error, setError] = useState('')

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center" data-testid="pdf-preview-error">
        <AlertCircleIcon className="size-8 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  return (
    <div className="size-full" data-testid="pdf-preview">
      <PDFViewer
        config={{
          src: url,
          theme: { preference: 'system' },
        }}
        style={{ width: '100%', height: '100%' } as CSSProperties}
        onReady={() => setError('')}
      />
    </div>
  )
}
