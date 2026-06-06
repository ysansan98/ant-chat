'use client'

import type { CSSProperties, ElementType } from 'react'
import { cn } from '@workspace/ui/lib/utils'
import { memo, useMemo } from 'react'

export interface TextShimmerProps {
  children: string
  as?: ElementType
  className?: string
  duration?: number
  spread?: number
}

function ShimmerComponent({
  children,
  as: Component = 'p',
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) {
  const dynamicSpread = useMemo(
    () => `${(children?.length ?? 0) * spread}px`,
    [children, spread],
  )

  return (
    <Component
      className={cn(
        'animate-shimmer relative inline-block bg-size-[250%_100%,auto] bg-clip-text text-transparent',
        '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]',
        className,
      )}
      style={
        {
          '--spread': dynamicSpread,
          'backgroundImage':
            'var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))',
          'animationDuration': `${duration}s`,
        } as CSSProperties
      }
    >
      {children}
    </Component>
  )
}

export const Shimmer = memo(ShimmerComponent)
