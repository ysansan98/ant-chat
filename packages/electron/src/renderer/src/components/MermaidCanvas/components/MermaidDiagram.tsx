import { Alert } from 'antd'
import mermaid from 'mermaid'
import React, { useEffect, useRef, useState } from 'react'
import { useThemeStore } from '@/store/theme'
import { useDraggable } from '../hooks/useDraggable'
import { useZoomable } from '../hooks/useZoomable'
import { downloadSvgToPng, getSvgSize } from '../utils'
import { CanvasControls } from './CanvasControls'

interface RenderMermaidProps {
  children: string
  className?: string
  style?: React.CSSProperties
}

export function MermaidDiagram({ children, className, style }: RenderMermaidProps) {
  const id = useRef(`d-${Date.now()}-mermaid`)
  const containerRef = useRef<HTMLDivElement>(null)
  const theme = useThemeStore(state => state.theme)
  const { position, isDragging, handleMouseDown, handleMouseMove, handleMouseUp } = useDraggable()
  const [initialSize, setInitialSize] = useState({ width: 0, height: 0 })
  const { size } = useZoomable(initialSize)

  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    const renderMermaid = async () => {
      try {
        // 确保容器是空的
        if (containerRef.current) {
          containerRef.current.innerHTML = ''
        }

        mermaid.initialize({
          suppressErrorRendering: true,
          startOnLoad: false,
          securityLevel: 'antiscript',
          theme: theme === 'dark' ? 'dark' : 'default',
        })

        // 渲染 mermaid
        const { svg } = await mermaid.render(id.current, children)

        if (containerRef.current && isMounted) {
          containerRef.current.innerHTML = svg
          const svgElement = containerRef.current.querySelector('svg')

          if (!svgElement) {
            return
          }

          svgElement.setAttribute('style', 'width: 100%; height: 100%;')

          // 使用 requestAnimationFrame 确保在下一帧获取尺寸
          requestAnimationFrame(() => {
            const bbox = getSvgSize(svgElement)
            setInitialSize({
              width: bbox.width,
              height: bbox.height,
            })

            setErrorMessage('')
          })
        }
      }
      catch (error) {
        console.error('Mermaid rendering error:', error)
        setErrorMessage((error as Error).message)
      }
    }

    renderMermaid()

    return () => {
      isMounted = false
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
      setErrorMessage('')
    }
  }, [children, theme])

  if (errorMessage) {
    return (
      <Alert
        message={errorMessage}
        type="error"
      />
    )
  }
  return (
    <div
      className={`
        relative h-full w-full overflow-auto
        ${className}
      `}
      style={style}
    >
      {
        errorMessage
          ? (
              <Alert
                message={errorMessage}
                description="请检查代码是否正确"
                type="error"
              />
            )
          : (
              <>
                <div
                  ref={containerRef}
                  className={`
                    mermaid-container absolute overflow-hidden rounded-md border-1 border-solid
                    border-gray-300
                  `}
                  style={{
                    left: position.x,
                    top: position.y,
                    width: size.width > 0 ? size.width : '100%',
                    height: size.height > 0 ? size.height : '100%',
                    cursor: isDragging ? 'grabbing' : 'grab',
                  }}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />
                <CanvasControls
                  onDownload={() => {
                    downloadSvgToPng(containerRef.current!)
                  }}
                />
              </>
            )
      }

    </div>
  )
}

export default MermaidDiagram
