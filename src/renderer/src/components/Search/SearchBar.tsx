import type { SearchResult } from '@ant-chat/shared'
import { SearchOutlined } from '@ant-design/icons'
import { debounce } from 'lodash-es'
import React from 'react'
import { dbApi } from '@/api/dbApi'
import { SearchResults } from './SearchResults'

interface SearchBarProps {
  onItemClick: (item: SearchResult, messageId: string) => void
}

export function SearchBar({ onItemClick }: SearchBarProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [keywords, setKeyword] = React.useState('')
  const [items, setItems] = React.useState<SearchResult[]>([])

  const debouncedSearch = React.useMemo(
    () => debounce(async (value: string) => {
      if (!value.trim()) {
        setItems([])
        return
      }
      const result = await dbApi.searchByKeyword(value)
      setItems(result)
    }, 300),
    [],
  )

  React.useEffect(() => {
    debouncedSearch(keywords)

    return () => {
      debouncedSearch.cancel()
    }
  }, [keywords])

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  return (
    <>
      <div
        className={`
          absolute top-20 left-1/2 w-4xl translate-x-[-50%] rounded-xl bg-white
          dark:bg-gray-800
        `}
      >
        <div className={`
          m-3 flex items-center gap-2 rounded-md border border-solid border-(--border-color) p-2
        `}
        >
          <SearchOutlined className="text-[1.5em] text-[#9ca3af]!" />
          <input
            ref={inputRef}
            className={`
              h-8 w-full
              focus:outline-none
            `}
            type="text"
            placeholder="Search..."
            value={keywords}
            autoFocus
            onChange={e => setKeyword(e.target.value)}
          />
        </div>
        {
          keywords.length
            ? (
                <div className="">
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
