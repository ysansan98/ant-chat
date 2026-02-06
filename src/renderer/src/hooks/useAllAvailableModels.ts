import { useRequest } from 'ahooks'
import { providerApi } from '@/api/providerApi'

export function useAllAvailableModels() {
  return useRequest(providerApi.getAllAbvailableModels)
}
