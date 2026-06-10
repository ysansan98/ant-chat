import type { SearchResult } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

export const searchApi = {
  searchByKeyword: async (keyword: string): Promise<SearchResult[]> => {
    return (await getAppTransport()).search.searchByKeyword(keyword)
  },
}
