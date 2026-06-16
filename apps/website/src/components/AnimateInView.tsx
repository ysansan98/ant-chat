import type { ReactNode } from 'react'
import { useInView } from '@/hooks/useInView'

interface AnimateInViewProps {
  children: ReactNode
  className?: string
  delay?: number
  direction?: 'up' | 'down' | 'left' | 'right' | 'none'
}

export default function AnimateInView({
  children,
  className = '',
  delay = 0,
  direction = 'up',
}: AnimateInViewProps) {
  const { ref, isInView } = useInView({ threshold: 0.1 })

  const directionStyles = {
    up: 'translate-y-8',
    down: '-translate-y-8',
    left: 'translate-x-8',
    right: '-translate-x-8',
    none: '',
  }

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        isInView
          ? 'translate-x-0 translate-y-0 opacity-100'
          : `${directionStyles[direction]} opacity-0`
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}
