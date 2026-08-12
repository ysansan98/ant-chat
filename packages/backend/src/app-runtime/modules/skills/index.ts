import type { AppRpcInput } from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { SkillManagementService } from '../../../agent-runtime'
import { Method, Module } from '../../decorators'

@Module('skills')
export class SkillsModule implements RuntimeModuleMethods<'skills'> {
  readonly service: SkillManagementService

  constructor(core: Pick<RuntimeCore, 'paths'>) {
    this.service = new SkillManagementService({ skillsRoot: core.paths.skillsRoot })
  }

  initialize() {
    return this.service.ensureInitialized()
  }

  @Method()
  listSkills(_input: AppRpcInput<'skills.listSkills'>) {
    return this.service.listSkills()
  }

  @Method()
  importSkill(input: AppRpcInput<'skills.importSkill'>) {
    return this.service.importSkill(input.options)
  }

  @Method()
  setSkillEnabled(input: AppRpcInput<'skills.setSkillEnabled'>) {
    return this.service.setEnabled(input.options.name, input.options.enabled)
  }

  @Method()
  async deleteSkill(input: AppRpcInput<'skills.deleteSkill'>) {
    await this.service.deleteSkill(input.name)
    return null
  }

  @Method()
  async rebuildSkillIndex(_input: AppRpcInput<'skills.rebuildSkillIndex'>) {
    return {
      rootPath: this.service.getSkillsRoot(),
      skills: await this.service.rebuildIndex(),
    }
  }
}
