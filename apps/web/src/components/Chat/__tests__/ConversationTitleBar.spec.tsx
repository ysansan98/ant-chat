import type { IConversations } from '@ant-chat/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConversationTitleBar } from '../ConversationTitleBar'

describe('conversationTitleBar', () => {
  it('从会话标题栏打开执行轨迹', () => {
    const onOpenTrace = vi.fn()
    render(<ConversationTitleBar conversation={conversation()} onOpenTrace={onOpenTrace} />)

    fireEvent.click(screen.getByRole('button', { name: '打开执行轨迹' }))

    expect(onOpenTrace).toHaveBeenCalledOnce()
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
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  }
}
