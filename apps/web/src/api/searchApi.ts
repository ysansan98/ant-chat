import type { SearchResult } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

export const searchApi = {
  searchByKeyword: async (keyword: string): Promise<SearchResult[]> => {
    return getAppRpcClient().call('search.searchByKeyword', { query: keyword })
  },
}
