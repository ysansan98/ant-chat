import type { AgentExecutionPhase, AgentPendingAction, AgentTaskStatus, ChannelType, ModelInfo } from '@ant-chat/shared'
import type { ChannelInboundEvent } from './channelRuntime'

export interface ChannelExecutionStep {
  id: string
  label: string
  status: 'running' | 'success' | 'failed'
}

export type ChannelCardAction
  = | { label: string, token: string, style?: 'primary' | 'danger' | 'default' }

export type ChannelOutboundContent
  = | { kind: 'text', text: string }
    | {
      kind: 'execution'
      executionId: string
      status: AgentTaskStatus
      phase?: AgentExecutionPhase
      text: string
      model: ModelInfo
      steps: ChannelExecutionStep[]
      pendingAction?: AgentPendingAction
      visualization?: { title: string, summary: string }
      actions?: ChannelCardAction[]
    }
    | {
      kind: 'model-selection'
      title: string
      token: string
      models: Array<{ label: string, value: string, selected: boolean }>
    }
    | {
      kind: 'permission-mode-selection'
      title: string
      token: string
      modes: Array<{ label: string, value: string, selected: boolean }>
    }
    | { kind: 'notice', title: string, text: string, tone?: 'info' | 'success' | 'warning' | 'error' }

export interface ChannelSendInput {
  externalChatId: string
  content: ChannelOutboundContent
}
export interface ChannelSendResult { externalMessageId: string }
export interface ChannelUpdateInput {
  externalMessageId: string
  content: Exclude<ChannelOutboundContent, { kind: 'text' }>
}
export interface ChannelTypingInput { externalMessageId: string, typing: boolean }
export interface ChannelTypingResult { changed: boolean }
export interface ChannelSetupInput { channelAccountId: string, credential: string }
export interface ChannelActionEvent {
  channelAccountId: string
  externalEventId: string
  externalUserId: string
  externalChatId: string
  externalMessageId: string
  actionToken: string
  formValues?: Record<string, string>
}
export interface ChannelActionResult {
  status: 'success' | 'error'
  message: string
  updatedContent?: Exclude<ChannelOutboundContent, { kind: 'text' }>
}
export interface ChannelConnector {
  readonly type: ChannelType
  setup: (input: ChannelSetupInput) => Promise<unknown>
  start: (input: {
    channelAccountId: string
    credential?: string
    onInbound: (event: ChannelInboundEvent) => Promise<void>
    onAction: (event: ChannelActionEvent) => Promise<ChannelActionResult>
  }) => Promise<void>
  stop: () => Promise<void>
  send: (input: ChannelSendInput) => Promise<ChannelSendResult>
  update?: (input: ChannelUpdateInput) => Promise<void>
  setTyping?: (input: ChannelTypingInput) => Promise<ChannelTypingResult>
  getStatus: () => { status: 'configured' | 'connecting' | 'connected' | 'degraded' | 'disconnected', lastError?: string }
}
