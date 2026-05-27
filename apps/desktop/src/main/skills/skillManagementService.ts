import { SkillFsService } from '@ant-chat/agent-core'
import { getSkillsRoot } from './skillsRoot'

export const skillManagementService = new SkillFsService({
  skillsRoot: getSkillsRoot(),
})
