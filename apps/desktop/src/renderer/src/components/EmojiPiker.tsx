import { EmojiPicker } from '@ferrucc-io/emoji-picker'
import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import React from 'react'

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
        <div className="">
          <EmojiPicker className="border-(--border-color)" onEmojiSelect={handleEmojiSelect}>
            <EmojiPicker.Group>
              <EmojiPicker.List containerHeight={200} />
            </EmojiPicker.Group>
          </EmojiPicker>
        </div>
      </PopoverContent>
    </Popover>
  )
}
