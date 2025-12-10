import type { AudioProps } from '@lobehub/tts/es/react/AudioPlayer'
import { createContext } from 'react'

// úš„íóMn
export const DEFAULT_VOICE_CONFIG = {
  voice: 'zh-CN-YunxiaNeural',
  locale: 'zh-CN',
}

export const AudioPlayContext = createContext<{

  isPlaying: boolean
  isLoading: boolean
  currentMessageId: string | null
  audio: AudioProps & {
    arrayBuffers: ArrayBuffer[]
  }

  playMessage: (messageId: string, content: string) => Promise<void>
  stopPlayback: () => void
} | null>(null)
