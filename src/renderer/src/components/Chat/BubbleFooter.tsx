import type { IMessage } from '@ant-chat/shared'
import { CopyOutlined, DeleteOutlined, LoadingOutlined, SoundOutlined, SyncOutlined } from '@ant-design/icons'
import { Button, Flex } from 'antd'
import { useMemo } from 'react'
import { Role } from '@/constants'
import { useAudioPlayContext } from '@/contexts/audioplay'

interface BubbleFooterProps {
  message: IMessage
  onClick?: (buttonName: string, message: IMessage) => void
}

export default function BubbleFooter({ message, onClick }: BubbleFooterProps) {
  const {
    playMessage,
    stopPlayback,
    isPlaying,
    isLoading,
    currentMessageId,
  } = useAudioPlayContext()

  // 判断当前消息是否正在播放
  const isCurrentMessagePlaying = currentMessageId === message.id && isPlaying

  // 提取消息文本内容
  const getMessageText = (message: IMessage): string => {
    if (!message.content || !Array.isArray(message.content))
      return ''

    return message.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n')
  }

  const messageText = getMessageText(message)

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

  const playAudioButton = useMemo(() => (
    <Button
      type="text"
      shape="circle"
      size="small"
      icon={
        isLoading && isCurrentMessagePlaying
          ? <LoadingOutlined />
          : isCurrentMessagePlaying
            ? <SoundOutlined style={{ color: '#1890ff' }} />
            : <SoundOutlined />
      }
      disabled={message.role !== Role.AI || !messageText.trim()}
      onClick={() => {
        if (isCurrentMessagePlaying) {
          stopPlayback()
        }
        else if (messageText.trim()) {
          playMessage(message.id, messageText)
        }
      }}
      title={
        isCurrentMessagePlaying
          ? '停止播放'
          : '播放语音'
      }
    />
  ), [
    message,
    isCurrentMessagePlaying,
    isLoading,
    messageText,
    playMessage,
    stopPlayback,
  ])

  const finallyButtons: Array<{ key: string, node: React.ReactNode }> = [{ key: 'copy', node: copyButton }]

  if (message.role === Role.AI) {
    finallyButtons.push({ key: 'refresh', node: refreshButton })
    finallyButtons.push({ key: 'audio', node: playAudioButton })
  }

  if (message.role !== Role.SYSTEM) {
    finallyButtons.push({ key: 'delete', node: deleteButton })
  }

  return (
    <Flex className={`
      opacity-0 transition-opacity duration-200
      group-hover:opacity-100
    `}
    >
      {finallyButtons.map(item => item.node && (
        <span key={item.key}>{item.node}</span>
      ))}
    </Flex>
  )
}
