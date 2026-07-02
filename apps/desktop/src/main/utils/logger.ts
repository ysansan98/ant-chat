import { getAppRuntimeLogger } from '@ant-chat/backend'
import { resolveAppDataRoot } from '@ant-chat/shared'

export const logger = getAppRuntimeLogger(resolveAppDataRoot())
