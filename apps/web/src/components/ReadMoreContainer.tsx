import { Button } from '@workspace/ui/components/button'
import { Separator } from '@workspace/ui/components/separator'
import { ArrowUp } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'

// Define the props interface for type safety
interface ReadMoreContainerProps {
  /**
   * The content to be displayed within the component.
   */
  children: React.ReactNode
  /**
   * The maximum height (in pixels) before truncating the content.
   */
  maxHeight: number
  /**
   * Text for the button when content is collapsed. Defaults to '查看全部'.
   */
  readMoreText?: string
  /**
   * Text for the button when content is expanded. Defaults to '收起'.
   */
  showLessText?: string
}

const ReadMoreContainer: React.FC<ReadMoreContainerProps> = ({
  children,
  maxHeight,
  readMoreText = '查看全部',
  showLessText = '收起',
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false)
  const [isOverflowing, setIsOverflowing] = useState<boolean>(false)
  const [fullHeight, setFullHeight] = useState<number | null>(null)

  const contentRef = useRef<HTMLDivElement>(null)

  const checkOverflow = useCallback(() => {
    const contentElement = contentRef.current
    if (contentElement) {
      const height = contentElement.scrollHeight
      setFullHeight(height)
      const doesOverflow = height > maxHeight
      // Prevent unnecessary re-renders if overflow state hasn't changed
      if (doesOverflow !== isOverflowing) {
        setIsOverflowing(doesOverflow)
      }
    }
  }, [maxHeight, isOverflowing])

  useEffect(() => {
    checkOverflow()

    window.addEventListener('resize', checkOverflow)
    return () => {
      window.removeEventListener('resize', checkOverflow)
    }
  }, [checkOverflow, children])

  const toggleExpand = (): void => {
    setIsExpanded(!isExpanded)
  }

  const contentStyle: React.CSSProperties = {
    maxHeight: isExpanded ? `${fullHeight ?? 'none'}px` : `${maxHeight}px`,
    overflow: 'hidden',
    transition: 'max-height 0.3s ease-in-out',
  }

  return (
    <div>
      <div
        ref={contentRef}
        style={contentStyle}
        className="box-border" // Ensures padding/border included in height
      >
        {children}
      </div>

      {isOverflowing && (
        <div className="flex flex-col items-center">
          <Separator className="my-1 w-full" />
          <Button
            variant="link"
            size="xs"
            className="text-xs"
            onClick={toggleExpand}
          >
            <ArrowUp className={isExpanded ? '' : 'rotate-180'} />
            {isExpanded ? showLessText : readMoreText}
          </Button>
        </div>
      )}
    </div>
  )
}

export default ReadMoreContainer
