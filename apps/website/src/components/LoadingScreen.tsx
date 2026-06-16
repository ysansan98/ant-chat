import { useEffect, useState } from 'react'

export default function LoadingScreen() {
  const [isVisible, setIsVisible] = useState(true)
  const [isFading, setIsFading] = useState(false)

  useEffect(() => {
    const fadeTimer = setTimeout(() => setIsFading(true), 800)
    const hideTimer = setTimeout(() => setIsVisible(false), 1200)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(hideTimer)
    }
  }, [])

  if (!isVisible)
    return null

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-background transition-opacity duration-500 ${
        isFading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <img
            src="/logo.svg"
            alt="Ant Chat"
            className="h-16 w-16 animate-pulse"
          />
          <div className="absolute inset-0 h-16 w-16 animate-ping rounded-full bg-accent/20" />
        </div>
        <div className="flex gap-1.5">
          <span className="dot-animation h-2 w-2 rounded-full bg-primary" style={{ animationDelay: '0ms' }} />
          <span className="dot-animation h-2 w-2 rounded-full bg-primary" style={{ animationDelay: '150ms' }} />
          <span className="dot-animation h-2 w-2 rounded-full bg-primary" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}
