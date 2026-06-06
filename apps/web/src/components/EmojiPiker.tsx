import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import React from 'react'
import { EmojiGrid } from './EmojiPicker/EmojiGrid'

export interface EmojiPickerProps {
  value?: string
  onChange?: (e: string) => void
}

export function EmojiPickerHoc({ value, onChange }: EmojiPickerProps) {
  const [open, setOpen] = React.useState(false)
  function handleEmojiSelect(e: string) {
    onChange?.(e)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" type="button" className="w-fit min-w-10">
          {value || '选择'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <EmojiGrid onEmojiSelect={handleEmojiSelect} containerHeight={200} />
      </PopoverContent>
    </Popover>
  )
}
