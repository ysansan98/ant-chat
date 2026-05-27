import path from 'node:path'
import { getAppDataRoot } from '@main/utils/appPaths'

export function getSkillsRoot(): string {
  return path.join(getAppDataRoot(), 'skills')
}
