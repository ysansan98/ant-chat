'use client'

import type { ComponentProps } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  ScrollArea,
  ScrollBar,
} from '@workspace/ui/components/scroll-area'
import { cn } from '@workspace/ui/lib/utils'
import { useCallback } from 'react'

export type SuggestionsProps = ComponentProps<typeof ScrollArea>

export function Suggestions({
  className,
  children,
  ...props
}: SuggestionsProps) {
  return (
    <ScrollArea className="w-full overflow-x-auto whitespace-nowrap" {...props}>
      <div className={cn('flex w-max flex-nowrap items-center gap-2', className)}>
        {children}
      </div>
      <ScrollBar className="hidden" orientation="horizontal" />
    </ScrollArea>
  )
}

export type SuggestionProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  suggestion: string
  onClick?: (suggestion: string) => void
}

export function Suggestion({
  suggestion,
  onClick,
  className,
  variant = 'outline',
  size = 'sm',
  children,
  ...props
}: SuggestionProps) {
  const handleClick = useCallback(() => {
    onClick?.(suggestion)
  }, [onClick, suggestion])

  return (
    <Button
      className={cn('cursor-pointer rounded-full px-4', className)}
      onClick={handleClick}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children || suggestion}
    </Button>
  )
}
