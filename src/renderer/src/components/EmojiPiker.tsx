import { EmojiPicker } from '@ferrucc-io/emoji-picker'
import { Button, Popover } from 'antd'
import React from 'react'

export interface EmojiPickerProps {
  value?: string
  onChange?: (e: string) => void
}

export function EmojiPickerHoc({ value, onChange }: EmojiPickerProps) {
  const [open, setOpen] = React.useState(false)
  function handleEmojiSelect(e: string) {
    // console.log('handleEmojiSelect => ', e)
    onChange?.(e)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      trigger="click"
      placement="rightTop"
      destroyOnHidden
      styles={{ content: { padding: 0, width: 300 } }}
      content={(
        <div className="">
          <EmojiPicker className="border-(--border-color)" onEmojiSelect={handleEmojiSelect}>
            {/* <EmojiPicker.Header>
              <EmojiPicker.Input placeholder="Search emoji" />
            </EmojiPicker.Header> */}
            <EmojiPicker.Group>
              <EmojiPicker.List containerHeight={200} />
            </EmojiPicker.Group>
          </EmojiPicker>
        </div>
      )}
      onOpenChange={value => setOpen(value)}
    >
      <Button
        icon={<span>{value}</span>}
        onClick={(e) => {
          e.preventDefault()
        }}
      />
    </Popover>
  )
}
