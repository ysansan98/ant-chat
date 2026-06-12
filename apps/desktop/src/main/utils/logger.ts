import { getAppRuntimeLogger } from '@ant-chat/app-runtime'
import { resolveAppDataRoot } from '@ant-chat/shared'

export const logger = getAppRuntimeLogger(resolveAppDataRoot())
