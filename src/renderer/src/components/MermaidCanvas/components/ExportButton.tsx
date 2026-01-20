import type { Exporter } from '../utils'
import { DownloadOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import React from 'react'
import { useThemeStore } from '@/store/theme'
import { getBase64SVG, getSvgSize, simulateDownload } from '../utils'

interface ExportButtonProps {
  containerRef: React.RefObject<HTMLDivElement | null>
}

export const ExportButton: React.FC<ExportButtonProps> = ({ containerRef }) => {
  const theme = useThemeStore(state => state.theme)

  const handleExport = async (event: React.MouseEvent) => {
    const canvas = document.createElement('canvas')
    const svg = containerRef.current?.querySelector('svg')
    if (!svg) {
      throw new Error('svg not found')
    }

    const bbox = getSvgSize(svg)
    canvas.width = bbox.width
    canvas.height = bbox.height

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('context not found')
    }

    context.fillStyle = theme === 'dark' ? '#000' : '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)

    const image = new Image()
    image.onload = () => {
      const downloadImage: Exporter = (context, image) => {
        return () => {
          const { canvas } = context
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
          simulateDownload(
            `${Date.now()}.png`,
            canvas.toDataURL('image/png').replace('image/png', 'image/octet-stream'),
          )
        }
      }
      downloadImage(context, image)()
    }

    image.src = `data:image/svg+xml;base64,${getBase64SVG(svg as unknown as HTMLElement, canvas.width, canvas.height)}`

    event.stopPropagation()
    event.preventDefault()
  }

  return (
    <div
      style={{
        position: 'absolute',
        right: 10,
        top: 10,
        zIndex: 1000,
      }}
    >
      <Button
        icon={<DownloadOutlined />}
        onClick={handleExport}
        title="下载PNG"
      />
    </div>
  )
}
