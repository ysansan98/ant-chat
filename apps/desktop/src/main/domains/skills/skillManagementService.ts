import { SkillFsReader } from '@ant-chat/agent-core'
import { getSkillsRoot } from './skillsRoot'

export const skillManagementService = new SkillFsReader({
  skillsRoot: getSkillsRoot(),
})
