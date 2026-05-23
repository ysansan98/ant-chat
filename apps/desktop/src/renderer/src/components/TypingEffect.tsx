import { useEffect, useState } from 'react'

interface TypingEffectProps {
  text: string
  speed?: number
  onComplete?: () => void
}

function TypingEffect({ text, speed = 150, onComplete }: TypingEffectProps) {
  const [displayedText, setDisplayedText] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    let timeoutId: NodeJS.Timeout

    if (index < text.length) {
      timeoutId = setTimeout(() => {
        setDisplayedText(prevText => prevText + text[index])
        setIndex(prevIndex => prevIndex + 1)
      }, speed)
    }
    else {
      onComplete && onComplete() // 打字完成后调用回调
    }

    return () => clearTimeout(timeoutId) // 清除 timeout
  }, [index, text, speed, onComplete])

  return <span>{displayedText}</span>
}
export default TypingEffect
