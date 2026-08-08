import type { AgentExecutionPhase, AgentPendingAction, AgentTaskStatus, ChannelAttachment, ChannelType, ModelInfo } from '@ant-chat/shared'
import type { ChannelInboundEvent } from './channelRuntime'

export type { ChannelAttachment }

export interface ChannelExecutionStep {
  id: string
  label: string
  status: 'running' | 'success' | 'failed'
}

export type ChannelCardAction
  = | { label: string, token: string, style?: 'primary' | 'danger' | 'default' }

export type ChannelOutboundContent = (
  | { kind: 'text', text: string }
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
) & { attachments?: ChannelAttachment[] }

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
export interface ChannelConnectorStatus {
  status: 'configured' | 'connecting' | 'connected' | 'degraded' | 'disconnected'
  lastError?: string
}
export interface ConnectorState<T> {
  getStatus: () => ChannelConnectorStatus
  beginConnect: () => void
  setConnected: () => void
  setDegraded: (error: unknown) => void
  setDisconnected: () => void
  activeTransport: T | undefined
  stopActive: (stop: (transport: T) => Promise<void>) => Promise<void>
}
/** 连接生命周期状态机 + transport 持有，两个平台 connector 共用同一套语义。 */
export function createConnectorState<T>(): ConnectorState<T> {
  let status: ChannelConnectorStatus = { status: 'disconnected' }
  let activeTransport: T | undefined
  return {
    getStatus: () => status,
    beginConnect: () => {
      status = { status: 'connecting' }
    },
    setConnected: () => {
      status = { status: 'connected' }
    },
    setDegraded: (error) => {
      status = { status: 'degraded', lastError: error instanceof Error ? error.message : String(error) }
    },
    setDisconnected: () => {
      status = { status: 'disconnected' }
    },
    get activeTransport() {
      return activeTransport
    },
    set activeTransport(value: T | undefined) {
      activeTransport = value
    },
    async stopActive(stop) {
      const transport = activeTransport
      activeTransport = undefined
      if (transport)
        await stop(transport)
      status = { status: 'disconnected' }
    },
  }
}
/** 平台传输能力。调用方依赖它选择发送策略，而不是探测方法是否存在。 */
export interface ChannelCapabilities {
  /** 平台能否编辑已发送的消息（卡片平台为 true，纯文本平台为 false）。 */
  supportsUpdate: boolean
}
export interface ChannelConnector {
  readonly type: ChannelType
  readonly capabilities: ChannelCapabilities
  setup: (input: ChannelSetupInput) => Promise<unknown>
  start: (input: {
    channelAccountId: string
    credential?: string
    onInbound: (event: ChannelInboundEvent) => Promise<void>
    onAction: (event: ChannelActionEvent) => Promise<ChannelActionResult>
  }) => Promise<void>
  stop: () => Promise<void>
  send: (input: ChannelSendInput) => Promise<ChannelSendResult>
  /** 直接发送单个附件并返回平台消息 ID；失败必须抛错，由调用方决定如何呈现。 */
  sendAttachment: (input: { externalChatId: string, attachment: ChannelAttachment }) => Promise<{ messageId: string }>
  update?: (input: ChannelUpdateInput) => Promise<void>
  setTyping?: (input: ChannelTypingInput) => Promise<ChannelTypingResult>
  getStatus: () => ChannelConnectorStatus
}
