import { NodeRenderer, setDefaultI18nMap, setKaTeXWorker, setMermaidWorker } from 'markstream-react'
import KatexWorker from 'markstream-react/workers/katexRenderer.worker?worker&inline'
import MermaidWorker from 'markstream-react/workers/mermaidParser.worker?worker&inline'
import React, { useId } from 'react'
import 'katex/dist/katex.min.css'

export interface RenderMarkdownProps {
  content: string
  final?: boolean
}

setKaTeXWorker(new KatexWorker())
setMermaidWorker(new MermaidWorker())

setDefaultI18nMap({
  'common.copy': '复制',
  'common.copySuccess': '已复制',
  'common.decrease': '减少',
  'common.reset': '重置',
  'common.increase': '增加',
  'common.expand': '展开',
  'common.collapse': '收起',
  'common.preview': '预览',
  'common.source': '源码',
  'common.export': '导出',
  'common.open': '打开',
  'common.zoomIn': '放大',
  'common.zoomOut': '缩小',
  'common.resetZoom': '重置缩放',
  'image.loadError': '图片加载失败',
  'image.loading': '图片加载中...',
})

function RenderMarkdown({ content }: RenderMarkdownProps) {
  const customId = useId()

  return (
    <NodeRenderer
      content={content}
      indexKey={customId}
      viewportPriority={false}
    />
  )
}

export default React.memo(RenderMarkdown)
