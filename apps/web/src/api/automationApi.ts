import type { AutomationDefinition, AutomationInput, AutomationRun, UpdateAutomationInput } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

export const automationApi = {
  list: (): Promise<AutomationDefinition[]> => getAppRpcClient().call('automation.list', undefined),
  create: (input: AutomationInput): Promise<AutomationDefinition> => getAppRpcClient().call('automation.create', { input }),
  update: (input: UpdateAutomationInput): Promise<AutomationDefinition> => getAppRpcClient().call('automation.update', { input }),
  delete: (id: string): Promise<null> => getAppRpcClient().call('automation.delete', { id }),
  setEnabled: (id: string, enabled: boolean): Promise<AutomationDefinition> => getAppRpcClient().call('automation.setEnabled', { id, enabled }),
  runNow: (id: string): Promise<AutomationRun> => getAppRpcClient().call('automation.runNow', { id }),
  listRuns: (automationId?: string, limit?: number): Promise<AutomationRun[]> => getAppRpcClient().call('automation.listRuns', { automationId, limit }),
}
