import { useEffect, useReducer } from 'react'

interface Size {
  width: number
  height: number
}

export function useZoomable(initialSize: Size) {
  const [size, dispatch] = useReducer(
    (_s: Size, a: Size) => a,
    initialSize,
  )

  // 当 initialSize 变化时更新 size
  useEffect(() => {
    dispatch(initialSize)
  }, [initialSize])

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY
    const scaleFactor = delta > 0 ? 0.9 : 1.1

    const newWidth = size.width * scaleFactor
    const newHeight = size.height * scaleFactor

    if (newWidth > 100 && newHeight > 100) {
      dispatch({ width: newWidth, height: newHeight })
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

  return { size, setSize: (s: Size) => dispatch(s) }
}
