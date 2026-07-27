import type { AgentCommandHost, CommandInterpreter, CommandToolInput } from '@ant-chat/shared'

export type CommandRisk = 'ordinary' | 'requires_approval' | 'bottomline_block'

export type AvailableCommandHost = Extract<AgentCommandHost, { status: 'available' }>
export type CommandHost = AgentCommandHost

export type CommandInput = CommandToolInput

export interface PreparedCommandSegment {
  executable: string
  args: string[]
  cwd: string
  isCd: boolean
  isReadOnly: boolean
  resourceScope: 'workspace' | 'outside'
}

export interface PreparedCommandState {
  kind: 'command'
  interpreter: CommandInterpreter
  input: CommandInput
  command: string
  cwd: string
  segments: PreparedCommandSegment[]
  resourceScope: 'workspace' | 'outside'
  isReadOnly: boolean
  hasSecretEnv: boolean
  risk: CommandRisk
  riskReason?: string
  executionPlan: {
    executablePath: string
    args: string[]
    cwd: string
    environment: Record<string, string>
  }
  adapterState: unknown
}

export function isPreparedCommandState(value: unknown): value is PreparedCommandState {
  return Boolean(value)
    && typeof value === 'object'
    && (value as Partial<PreparedCommandState>).kind === 'command'
}
