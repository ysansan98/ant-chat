import type { SearchResult } from '@ant-chat/shared'
import { ipc, unwrapIpcResponse } from '@/utils/ipc-bus'

export const searchApi = {
  searchByKeyword: async (keyword: string): Promise<SearchResult[]> => {
    return unwrapIpcResponse(await ipc.search.searchByKeyword(keyword))
  },
}
