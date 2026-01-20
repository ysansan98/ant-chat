import { useEffect, useState } from 'react'

interface Size {
  width: number
  height: number
}

export function useZoomable(initialSize: Size) {
  const [size, setSize] = useState<Size>(initialSize)

  // 当 initialSize 变化时更新 size
  useEffect(() => {
    setSize(initialSize)
  }, [initialSize])

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY
    const scaleFactor = delta > 0 ? 0.9 : 1.1

    const newWidth = size.width * scaleFactor
    const newHeight = size.height * scaleFactor

    if (newWidth > 100 && newHeight > 100) {
      setSize({ width: newWidth, height: newHeight })
    }
  }

  useEffect(() => {
    const container = document.querySelector('.mermaid-container')
    if (!container)
      return

    container.addEventListener('wheel', handleWheel as EventListener, { passive: false })

    return () => {
      container.removeEventListener('wheel', handleWheel as EventListener)
    }
  }, [size.width, size.height])

  return { size, setSize }
}
