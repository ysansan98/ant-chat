import { XlsxViewer } from '@extend-ai/react-xlsx'
import { Spinner } from '@workspace/ui/components/spinner'
import { AlertCircleIcon } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { initPreviewWasm } from './wasmConfig'

interface ExcelPreviewProps {
  url: string
  fileName: string
}

/**
 * Excel 预览：基于 @extend-ai/react-xlsx（WASM 解析 + Canvas 渲染）。
 * 支持冻结窗格、列宽、样式、图表、sheet 切换，只读模式。
 * WASM 资源路径在首次渲染前通过 initPreviewWasm 配置。
 */
export function ExcelPreview({ url, fileName }: ExcelPreviewProps) {
  const [wasmReady, setWasmReady] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      initPreviewWasm()
      setWasmReady(true)
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center" data-testid="excel-preview-error">
        <AlertCircleIcon className="size-8 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (!wasmReady) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="excel-preview-loading">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="size-full" data-testid="excel-preview">
      <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner /></div>}>
        <XlsxViewer
          src={url}
          fileName={fileName}
          readOnly
          height="100%"
          showDefaultToolbar
        />
      </Suspense>
    </div>
  )
}
