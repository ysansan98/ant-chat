'use client'

import { cn } from '@workspace/ui/lib/utils'
import React from 'react'
import { EMOJI_GROUPS } from './emojis'

export interface EmojiGridProps {
  onEmojiSelect?: (emoji: string) => void
  className?: string
  containerHeight?: number
}

export function EmojiGrid({ onEmojiSelect, className, containerHeight = 200 }: EmojiGridProps) {
  const [activeGroup, setActiveGroup] = React.useState(0)

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Group tabs */}
      <div className="flex gap-1 border-b border-(--border-color) px-2 pt-1">
        {EMOJI_GROUPS.map((group, idx) => (
          <button
            key={group.label}
            type="button"
            className={cn(
              'rounded-t px-2.5 py-1 text-xs transition-colors',
              idx === activeGroup
                ? '-mb-px border border-b-0 border-(--border-color) bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setActiveGroup(idx)}
          >
            {group.label}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div
        className="overflow-y-auto p-2"
        style={{ height: containerHeight }}
      >
        <div className="grid grid-cols-10 gap-0.5">
          {EMOJI_GROUPS[activeGroup].emojis.map(emoji => (
            <button
              key={emoji}
              type="button"
              className="flex size-7 cursor-pointer items-center justify-center rounded-sm text-lg leading-none hover:bg-(--hover-bg-color)"
              onClick={() => onEmojiSelect?.(emoji)}
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
