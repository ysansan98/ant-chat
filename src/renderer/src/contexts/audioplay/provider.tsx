import { useEdgeSpeech } from '@lobehub/tts/react'
import { use, useCallback, useEffect, useRef, useState } from 'react'
import { AudioPlayContext, DEFAULT_VOICE_CONFIG } from './context'

export function AudioPlayProvider({ children }: { children: React.ReactNode }) {
  // 播放状态
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null)

  // 使用 @lobehub/tts 的基础配置
  const { start, stop, isLoading: edgeLoading, setText, audio } = useEdgeSpeech('', {
    options: {
      voice: DEFAULT_VOICE_CONFIG.voice,
    },
  })

  // 使用 ref 来跟踪是否应该开始播放
  const startTriggerRef = useRef(false)

  // 监听 setText 的调用，确保文本设置完成后再播放
  const playAfterTextSet = useCallback(() => {
    if (startTriggerRef.current) {
      console.log('文本已设置完成，开始播放')
      start()
      setIsPlaying(true)
      startTriggerRef.current = false
      setIsLoading(false)
    }
  }, [start])

  // 使用 useEffect 在每次渲染后检查是否需要播放
  useEffect(() => {
    // 延迟执行，确保 setText 已经生效
    const timer = setTimeout(playAfterTextSet, 10)
    return () => clearTimeout(timer)
  }, [playAfterTextSet])

  // 播放消息
  const playMessage = useCallback(async (messageId: string, content: string) => {
    // 验证内容
    if (!content || !content.trim()) {
      console.warn('尝试播放空内容:', messageId)
      return
    }

    // 如果正在播放同一消息，则停止
    if (isPlaying && currentMessageId === messageId) {
      stop()
      setIsPlaying(false)
      setCurrentMessageId(null)
      startTriggerRef.current = false
      // 清除文本内容，确保下次播放时能重新触发
      setText('')
      return
    }

    // 如果正在播放其他消息，先停止
    if (isPlaying) {
      stop()
      setIsPlaying(false)
      // 清除文本内容，确保下次播放时能重新触发
      setText('')
    }

    setIsLoading(true)
    setCurrentMessageId(messageId)

    try {
      // 设置要播放的文本
      const text = content.trim()
      setText(text)

      // 设置触发标志，让 useEffect 在下一轮渲染后开始播放
      startTriggerRef.current = true

      console.log('设置文本，准备播放消息:', messageId, `${text.substring(0, 50)}...`)
    }
    catch (error) {
      console.error('音频播放失败:', error)
      setIsLoading(false)
      setCurrentMessageId(null)
      startTriggerRef.current = false
    }
  }, [isPlaying, currentMessageId, stop, setText])

  // 停止播放
  const stopPlayback = useCallback(() => {
    stop()
    setIsPlaying(false)
    setCurrentMessageId(null)
    startTriggerRef.current = false
    // 清除文本内容，确保下次播放时能重新触发
    setText('')
  }, [stop, setText])

  const contextValue = {
    isPlaying,
    isLoading: isLoading || edgeLoading,
    currentMessageId,
    audio,
    playMessage,
    stopPlayback,
  }

  return (
    <AudioPlayContext value={contextValue}>
      {children}
    </AudioPlayContext>
  )
}

export function useAudioPlayContext() {
  const result = use(AudioPlayContext)
  if (!result) {
    throw new Error('useAudioPlayContext must be used within an AudioPlayProvider')
  }
  return result
}
