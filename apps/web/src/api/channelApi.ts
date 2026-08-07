import type { ChannelAccountView, ChannelType } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

export const listChannels = () => getAppRpcClient().call('channel.list', undefined)
export const setupChannel = (input: { channelType: ChannelType, displayName: string, defaultWorkspacePath: string, appId?: string, channelAccountId?: string }) => getAppRpcClient().call('channel.setup', input)
export const disconnectChannel = (id: string) => getAppRpcClient().call('channel.disconnect', { id })
export const createChannel = (input: { channelType: ChannelType, displayName: string, defaultWorkspacePath: string, appId?: string, channelAccountId?: string }) => getAppRpcClient().call('channel.setup', input)
export const getChannelSetupStatus = (setupId: string, verifyCode?: string) => getAppRpcClient().call('channel.getSetupStatus', { setupId, ...(verifyCode ? { verifyCode } : {}) })
export const updateChannel = (input: { id: string, displayName?: string, credential?: string, defaultWorkspacePath?: string | null }) => getAppRpcClient().call('channel.update', input)
export const deleteChannel = (id: string) => getAppRpcClient().call('channel.delete', { id })
export const listChannelPairings = (channelAccountId: string) => getAppRpcClient().call('channel.listPairings', { channelAccountId })
export const approveChannelPairing = (id: string) => getAppRpcClient().call('channel.approvePairing', { id })
export const revokeChannelPairing = (id: string) => getAppRpcClient().call('channel.revokePairing', { id })
export const getChannelStatus = (channelType: ChannelType) => getAppRpcClient().call('channel.getStatus', { channelType })
export const enableChannel = (id: string) => getAppRpcClient().call('channel.enable', { id })
export const disableChannel = (id: string) => getAppRpcClient().call('channel.disable', { id })
export type { ChannelAccountView }
