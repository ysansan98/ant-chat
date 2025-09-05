import { DownloadOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import React from 'react'
import { useRunnerCodeContext } from '../context/useRunnerCodeContext'

function RenderHTML() {
  const { config } = useRunnerCodeContext()
  const iframeRef = React.useRef<HTMLIFrameElement>(null)

  React.useEffect(() => {
    const iframeElement = iframeRef.current
    if (!iframeElement) {
      console.error('iframeElement is null')
      return
    }

    const iframeDoc = iframeElement.contentDocument || iframeElement.contentWindow?.document
    if (!iframeDoc) {
      console.error('iframeDoc is null')
      return
    }

    console.log('iframeDoc', iframeDoc)

    iframeDoc.open()
    iframeDoc.write(config.code)
    iframeDoc.close()
  }, [config.code])

  return (
    <div className="relative h-full w-full">
      <iframe ref={iframeRef} width="100%" height="100%" src="about:blank" />
      <div className="absolute top-5 right-5 flex items-center justify-around gap-2">
        <Button
          title="下载代码"
          icon={<DownloadOutlined />}
          onClick={() => {
            const blob = new Blob([config.code], { type: 'text/html;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.style.display = 'none'
            link.href = url
            link.download = `index-${Date.now()}.html`

            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)
          }}
        />
      </div>
    </div>

  )
}

export default RenderHTML
