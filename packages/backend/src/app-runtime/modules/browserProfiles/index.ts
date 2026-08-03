import type { AppRpcInput, BrowserIdentityStatus, BrowserProfileSourceView } from '@ant-chat/shared'
import type { BrowserIdentityStore } from '../../../browser-identity/browserIdentityStore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { Method, Module } from '../../decorators'

@Module('browserProfiles')
export class BrowserProfilesModule implements RuntimeModuleMethods<'browserProfiles'> {
  constructor(private readonly identity: BrowserIdentityStore) {}

  async initialize(): Promise<void> {
    await this.identity.initialize()
  }

  @Method()
  getStatus(_input: AppRpcInput<'browserProfiles.getStatus'>): Promise<BrowserIdentityStatus> {
    return this.identity.getStatus()
  }

  @Method()
  listSources(_input: AppRpcInput<'browserProfiles.listSources'>): Promise<BrowserProfileSourceView[]> {
    return this.identity.listSources()
  }

  @Method()
  import(input: AppRpcInput<'browserProfiles.import'>): Promise<BrowserIdentityStatus> {
    return input.sourceId ? this.identity.importSource(input.sourceId) : this.identity.updateCurrent()
  }

  @Method()
  async clear(_input: AppRpcInput<'browserProfiles.clear'>): Promise<null> {
    await this.identity.clear()
    return null
  }

  async importFromDirectory(directory: string): Promise<BrowserIdentityStatus> {
    return this.identity.importFromDirectory(directory)
  }
}
