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
 *
 * `allowResizeInReadOnly`：只读模式下允许拖拽调整行高/列宽。
 * 默认 readOnly 会一并禁用行列拖拽，导致长内容被裁剪无法查看，
 * 预览场景需要保留这一纯布局操作。
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
          rounded={false}
          readOnly
          allowResizeInReadOnly={true}
          height="100%"
          showDefaultToolbar={false}
          enableGestureZoom={true}
        />
      </Suspense>
    </div>
  )
}
