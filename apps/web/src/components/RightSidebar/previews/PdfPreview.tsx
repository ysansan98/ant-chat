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
 * 仅保留查看类能力：页码导航、缩放、搜索、缩略图侧栏、页面设置、全屏、文本选择。
 *
 * 隐藏「打开其他 PDF / 关闭文档」及所有编辑类入口：
 * - `tabBar: 'never'`：隐藏多文档标签栏（含关闭按钮和“+”打开按钮）。
 *   这些按钮直接调用 document-manager 能力、不经过命令系统，无法用 disabledCategories 隐藏。
 * - `disabledCategories`：按 category 在 UI 层隐藏菜单项/按钮，并在命令层禁用对应命令
 *   （防止快捷键触发）。文档菜单整体隐藏（Fullscreen 保留在「页面设置」菜单中）；
 *   批注/形状/插入/表单/涂黑等模式及其子工具栏全部禁用，View 模式标签因
 *   visibilityDependsOn 联动自动隐藏。
 * - `i18n.defaultLocale: 'zh-CN'`：界面文案本地化为简体中文。
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
          tabBar: 'never',
          i18n: { defaultLocale: 'zh-CN' },
          disabledCategories: [
            // 文档操作
            'document-open',
            'document-close',
            'document-menu',
            'document-print',
            'document-export',
            'document-capture',
            'document-protect',
            // 编辑类能力
            'annotation',
            'insert',
            'form',
            'redaction',
            'history',
            // 面板入口
            'panel-comment',
            'panel-annotation-style',
          ],
        }}
        style={{ width: '100%', height: '100%' } as CSSProperties}
        onReady={() => setError('')}
      />
    </div>
  )
}
