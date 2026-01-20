import type { SearchResult } from '@ant-chat/shared'
import { EnterOutlined, MessageOutlined } from '@ant-design/icons'
import { Empty } from 'antd'
import { HighlightText } from './HighlightText'

interface SearchResultsProps {
  keywords: string
  items: SearchResult[]
  onItemClick?: (item: SearchResult, messageId: string) => void
}

const IconMapping: Record<SearchResult['type'], React.ReactNode> = {
  message: <MessageOutlined className="text-[#9ca3af]!" />,
}

export function SearchResults({ items, keywords, onItemClick }: SearchResultsProps) {
  return items?.length
    ? (
        <div className="max-h-[60vh] overflow-y-auto px-3 pb-1">
          {
            items.map(item => (
              <div
                key={item.id}
                className={`
                  mt-2 rounded-md border border-solid border-(--border-color) p-2 transition-colors
                  duration-200
                `}
              >
                <div className="text-xs">
                  <div className="flex items-center gap-2 text-xs">
                    {IconMapping[item.type]}
                    <HighlightText
                      text={item.conversationTitle}
                      keywords={keywords}
                    />
                  </div>
                  <div className="mt-2 w-full">
                    {item.messages.map((message, index) => (
                      <div
                        key={message.id}
                        className={`
                          group flex w-full cursor-pointer items-center justify-between p-2 text-xs
                          hover:bg-(--hover-bg-color)
                        `}
                        onClick={() => onItemClick?.(item, message.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span>
                            {index + 1}
                          </span>
                          <HighlightText
                            text={message.content}
                            keywords={keywords}
                            className="flex-1"
                          />
                        </div>
                        <span className={`
                          hidden
                          group-hover/message:block
                        `}
                        >
                          <EnterOutlined />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))
          }
        </div>
      )
    : (
        keywords && (
          <div className="flex h-full w-full items-center justify-center">
            <Empty />
          </div>
        )
      )
}
