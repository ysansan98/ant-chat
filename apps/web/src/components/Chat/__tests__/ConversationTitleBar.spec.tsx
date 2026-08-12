import type { IConversations } from '@ant-chat/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renameConversationsAction } from '@/store/conversation'
import { ConversationTitleBar } from '../ConversationTitleBar'

vi.mock('@/store/conversation', () => ({
  renameConversationsAction: vi.fn(),
}))

describe('conversationTitleBar', () => {
  it('点击重命名后提交新标题', async () => {
    vi.mocked(renameConversationsAction).mockResolvedValue(undefined)
    render(<ConversationTitleBar conversation={conversation()} />)

    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '新标题' } })
    fireEvent.blur(input)

    expect(renameConversationsAction).toHaveBeenCalledWith('conversation-1', '新标题')
  })
})

function conversation(): IConversations {
  return {
    id: 'conversation-1',
    title: '可观测性计划',
    conversationInstructions: '',
    workspacePath: '/workspace',
    createdAt: 1,
    updatedAt: 1,
    settings: {
      providerId: 'provider-1',
      modelId: 'model-1',
    },
  }
}
