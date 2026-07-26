import type { ToolApprovalRuleInput } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

async function list() {
  return getAppRpcClient().call('permissions.list', undefined)
}

async function add(input: { scope: 'workspace' | 'global', workspacePath?: string, rule: ToolApprovalRuleInput }) {
  return getAppRpcClient().call('permissions.add', input)
}

async function update(input: { ruleId: string, scope: 'workspace' | 'global', workspacePath?: string, rule: ToolApprovalRuleInput }) {
  return getAppRpcClient().call('permissions.update', input)
}

async function remove(input: { ruleId: string, scope: 'workspace' | 'global', workspacePath?: string }) {
  return getAppRpcClient().call('permissions.delete', input)
}

async function clear(input: { scope: 'workspace' | 'global', workspacePath?: string }) {
  return getAppRpcClient().call('permissions.clear', input)
}

async function clearWorkspace(input: { workspacePath: string }) {
  return getAppRpcClient().call('permissions.clearWorkspace', input)
}

export default {
  list,
  add,
  update,
  remove,
  clear,
  clearWorkspace,
}
