import type { SearchResult } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { debounce } from 'lodash-es'
import { Search, XIcon } from 'lucide-react'
import React from 'react'
import { searchApi } from '@/api/searchApi'
import { SearchResults } from './SearchResults'

interface SearchBarProps {
  onItemClick: (item: SearchResult, messageId: string) => void
  onClose: () => void
}

export function SearchBar({ onItemClick, onClose }: SearchBarProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [keywords, setKeyword] = React.useState('')
  const [items, setItems] = React.useState<SearchResult[]>([])

  const debouncedSearch = React.useMemo(
    () => debounce(async (value: string) => {
      if (!value.trim()) {
        setItems([])
        return
      }
      const result = await searchApi.searchByKeyword(value)
      setItems(result)
    }, 300),
    [],
  )

  React.useEffect(() => {
    debouncedSearch(keywords)

    return () => {
      debouncedSearch.cancel()
    }
  }, [keywords, debouncedSearch])

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  return (
    <>
      <div
        data-testid="search-panel"
        className={`
          absolute top-3 left-1/2 flex max-h-[min(34rem,calc(100dvh-1.5rem))] w-[calc(100%-1.5rem)]
          max-w-lg -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-background shadow-lg
          sm:top-12
        `}
      >
        <div className="flex shrink-0 items-center gap-1 p-2">
          <div className={`
            flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-solid
            border-(--border-color) px-3
          `}
          >
            <Search className="size-4 text-muted-foreground" />
            <input
              ref={inputRef}
              className="h-full min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
              type="text"
              placeholder="搜索会话"
              value={keywords}
              autoFocus
              onChange={e => setKeyword(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label="关闭搜索"
            className="size-10"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
        {
          keywords.length
            ? (
                <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                  <SearchResults
                    keywords={keywords}
                    items={items}
                    onItemClick={onItemClick}
                  />
                </div>
              )
            : null
        }
      </div>
    </>
  )
}
