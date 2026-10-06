import type { BackgroundCommandSummary } from '@ant-chat/shared'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentRuntimeStore } from '@/store/agentRuntime'
import { BackgroundCommandPanel } from '../BackgroundCommandPanel'

vi.mock('@/api/agentApi', () => ({
  default: {
    readBackgroundCommandOutput: vi.fn(async () => ({
      text: 'log line',
      status: 'running',
      offset: 0,
      nextOffset: 8,
      truncated: false,
    })),
    killBackgroundCommand: vi.fn(async () => null),
  },
}))

function seed(conversationId: string, commands: Array<Partial<BackgroundCommandSummary>>) {
  useAgentRuntimeStore.setState(state => ({
    backgroundCommandsByConversation: {
      ...state.backgroundCommandsByConversation,
      [conversationId]: commands.map((command, index) => ({
        commandId: `cmd-${index}`,
        command: `pnpm dev ${index}`,
        description: `服务 ${index}`,
        cwd: '/workspace',
        status: 'running' as const,
        pid: 1000 + index,
        startedAt: 1,
        hasSecretEnv: false,
        secretEnvKeys: [],
        logPath: `/tmp/cmd-${index}.log`,
        truncated: false,
        ...command,
      })),
    },
  }))
}

describe('backgroundCommandPanel', () => {
  beforeEach(() => {
    useAgentRuntimeStore.setState({ backgroundCommandsByConversation: {} })
  })

  it('无后台命令时不占位', () => {
    const { container } = render(<BackgroundCommandPanel conversationId="conv-1" />)
    expect(container.innerHTML).toBe('')
  })

  it('渲染胶囊组，超出上限折叠为 +N', () => {
    seed('conv-1', Array.from({ length: 7 }, (_, index) => ({ commandId: `cmd-${index}`, description: `服务 ${index}` })))
    render(<BackgroundCommandPanel conversationId="conv-1" />)
    expect(screen.getByText('服务 0')).toBeInTheDocument()
    expect(screen.getByText('服务 4')).toBeInTheDocument()
    expect(screen.queryByText('服务 5')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+2' })).toBeInTheDocument()
  })

  it('运行中的胶囊自带终止入口', () => {
    seed('conv-1', [{ commandId: 'cmd-1', description: '开发服务' }])
    render(<BackgroundCommandPanel conversationId="conv-1" />)
    expect(screen.getByRole('button', { name: '终止：开发服务' })).toBeInTheDocument()
  })

  it('已结束命令不再占位', () => {
    seed('conv-1', [{ commandId: 'cmd-9', description: '构建', status: 'exited', exitCode: 0 }])
    const { container } = render(<BackgroundCommandPanel conversationId="conv-1" />)
    expect(container.innerHTML).toBe('')
  })

  it('运行中命令终止后立即移出面板', () => {
    seed('conv-1', [{ commandId: 'cmd-1', description: '开发服务' }])
    const { container } = render(<BackgroundCommandPanel conversationId="conv-1" />)
    expect(screen.getByText('开发服务')).toBeInTheDocument()

    act(() => {
      useAgentRuntimeStore.setState(state => ({
        backgroundCommandsByConversation: {
          ...state.backgroundCommandsByConversation,
          'conv-1': state.backgroundCommandsByConversation['conv-1']!.map(command => ({
            ...command,
            status: 'killed' as const,
            exitCode: 0,
            endedAt: 2,
          })),
        },
      }))
    })

    expect(container.innerHTML).toBe('')
  })

  it('只展示当前会话的命令', () => {
    seed('conv-1', [{ commandId: 'cmd-1', description: '会话一' }])
    seed('conv-2', [{ commandId: 'cmd-2', description: '会话二' }])
    render(<BackgroundCommandPanel conversationId="conv-2" />)
    expect(screen.getByText('会话二')).toBeInTheDocument()
    expect(screen.queryByText('会话一')).not.toBeInTheDocument()
  })
})
