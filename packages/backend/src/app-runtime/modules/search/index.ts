import type { AppRpcInput } from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { Method, Module } from '../../decorators'

@Module('search')
export class SearchModule implements RuntimeModuleMethods<'search'> {
  constructor(private readonly core: Pick<RuntimeCore, 'data'>) {}

  @Method()
  searchByKeyword(input: AppRpcInput<'search.searchByKeyword'>) {
    return this.core.data.messageSearchQuery.searchMessagesByKeyword(input.query)
  }
}
