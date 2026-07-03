import type { AppRpcInput } from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { Method, Module } from '../../decorators'

@Module('files')
export class FilesModule implements RuntimeModuleMethods<'files'> {
  constructor(private readonly core: Pick<RuntimeCore, 'data'>) {}

  @Method()
  getAttachmentData(input: AppRpcInput<'files.getAttachmentData'>) {
    return this.core.data.messageRepository.loadAttachmentData(input.fileId)
  }
}
