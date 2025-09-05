import type { IMessage } from '@ant-chat/shared'
import { CopyOutlined, DeleteOutlined, SyncOutlined } from '@ant-design/icons'
import { Button, Flex } from 'antd'
import { useMemo } from 'react'
import { Role } from '@/constants'

interface BubbleFooterProps {
  message: IMessage
  onClick?: (buttonName: string, message: IMessage) => void
}

export default function BubbleFooter({ message, onClick }: BubbleFooterProps) {
  const copyButton = useMemo(() => (
    <Button
      type="text"
      shape="circle"
      size="small"
      icon={<CopyOutlined />}
      onClick={() => {
        onClick?.('copy', message)
      }}
    />
  ), [onClick, message])

  const refreshButton = useMemo(() => (
    <Button
      type="text"
      shape="circle"
      size="small"
      icon={<SyncOutlined />}
      disabled={!['success', 'error'].includes(message.status || '')}
      onClick={() => {
        onClick?.('refresh', message)
      }}
    />
  ), [onClick, message])

  const deleteButton = useMemo(() => (
    <Button
      type="text"
      shape="circle"
      size="small"
      icon={<DeleteOutlined />}
      danger
      onClick={() => {
        onClick?.('delete', message)
      }}
    />
  ), [onClick, message])

  const finallyButtons: React.ReactNode[] = [copyButton]

  if (message.role === Role.AI) {
    finallyButtons.push(refreshButton)
  }

  if (message.role !== Role.SYSTEM) {
    finallyButtons.push(deleteButton)
  }

  return (
    <Flex className={`
      opacity-0 transition-opacity duration-200
      group-hover:opacity-100
    `}
    >
      {...finallyButtons}
    </Flex>
  )
}
