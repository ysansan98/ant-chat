import { Button } from '@workspace/ui/components/button'
import { Crosshair, Download } from 'lucide-react'
import React from 'react'

interface CanvasControlsProps {
  onReset?: () => void
  onDownload?: () => void
}

export const CanvasControls: React.FC<CanvasControlsProps> = ({
  onReset,
  onDownload,
}) => {
  return (
    <div
      className={`
        absolute top-5 right-5 flex gap-2 rounded-md bg-white p-2 shadow-md
        dark:bg-[#222]
      `}
    >
      {
        onReset && (
          <Button variant="outline" size="icon-sm" onClick={onReset} title="重置">
            <Crosshair />
          </Button>
        )
      }

      {
        onDownload && (
          <Button variant="outline" size="icon-sm" onClick={onDownload} title="下载">
            <Download />
          </Button>
        )
      }
    </div>
  )
}
