import { useRequest } from 'ahooks'
import { dbApi } from '@/api/dbApi'

export function useAllAvailableModels() {
  return useRequest(dbApi.getAllAbvailableModels)
}
