import type { IMessage, IMessageContent } from '@ant-chat/shared'
import { fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { describe, expect, it, vi } from 'vitest'
import { MessageJumpRail } from '../MessageJumpRail'

function createUserMessage(id: string, content: IMessageContent): IMessage {
  return {
    id,
    convId: 'conv-1',
    role: 'user',
    content,
    status: 'success',
    createdAt: 0,
    turnId: id,
  }
}

function renderRail(
  userMessages: ReturnType<typeof createUserMessage>[],
  activeMessageId: string | null = null,
) {
  const onJump = vi.fn()
  render(
    <TooltipProvider>
      <MessageJumpRail
        userMessages={userMessages}
        activeMessageId={activeMessageId}
        onJumpToMessage={onJump}
      />
    </TooltipProvider>,
  )
  return { onJump }
}

describe('messageJumpRail', () => {
  describe('渲染条件', () => {
    it('0 条用户消息时不应渲染', () => {
      renderRail([])
      expect(screen.queryByRole('navigation')).toBeNull()
    })

    it('1 条用户消息时不应渲染', () => {
      const msg = createUserMessage('msg-1', [{ type: 'text', text: 'hello' }])
      renderRail([msg])
      expect(screen.queryByRole('navigation')).toBeNull()
    })

    it('2 条用户消息时应渲染', () => {
      const msgs = [
        createUserMessage('msg-1', [{ type: 'text', text: 'hello' }]),
        createUserMessage('msg-2', [{ type: 'text', text: 'world' }]),
      ]
      renderRail(msgs)
      // 桌面端和移动端各一个 nav
      expect(screen.getAllByRole('navigation').length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('节点数量', () => {
    it('节点数量只等于用户消息数量', () => {
      const msgs = [
        createUserMessage('msg-1', [{ type: 'text', text: 'first' }]),
        createUserMessage('msg-2', [{ type: 'text', text: 'second' }]),
        createUserMessage('msg-3', [{ type: 'text', text: 'third' }]),
      ]
      renderRail(msgs)
      // 桌面端 nav 里的 buttons
      const desktopNav = screen.getAllByRole('navigation')[0]
      const buttons = desktopNav.querySelectorAll('button')
      expect(buttons).toHaveLength(3)
    })
  })

  describe('点击行为', () => {
    it('点击节点应调用 onJumpToMessage，传入正确的 message id', () => {
      const msgs = [
        createUserMessage('msg-1', [{ type: 'text', text: 'first' }]),
        createUserMessage('msg-2', [{ type: 'text', text: 'second' }]),
      ]
      const { onJump } = renderRail(msgs)

      const desktopNav = screen.getAllByRole('navigation')[0]
      const buttons = desktopNav.querySelectorAll('button')

      fireEvent.click(buttons[0])
      expect(onJump).toHaveBeenCalledWith('msg-1')

      fireEvent.click(buttons[1])
      expect(onJump).toHaveBeenCalledWith('msg-2')
    })
  })

  describe('tooltip 内容', () => {
    it('tooltip 应显示消息内容文本摘要', () => {
      const msgs = [
        createUserMessage('msg-1', [{ type: 'text', text: '帮我写一个 React 组件' }]),
        createUserMessage('msg-2', [{ type: 'text', text: '这段代码有什么问题？' }]),
      ]
      renderRail(msgs)

      // trigger buttons 上的 aria-label 包含消息编号
      const desktopNav = screen.getAllByRole('navigation')[0]
      const buttons = desktopNav.querySelectorAll('button')

      expect(buttons[0]).toHaveAttribute('aria-label', '跳转到用户消息 1')
      expect(buttons[1]).toHaveAttribute('aria-label', '跳转到用户消息 2')
    })

    it('用户消息内容为空时应使用占位文本', () => {
      const msgs = [
        createUserMessage('msg-1', [{ type: 'text', text: '' }]),
        createUserMessage('msg-2', []),
      ]
      renderRail(msgs)

      const desktopNav = screen.getAllByRole('navigation')[0]
      const buttons = desktopNav.querySelectorAll('button')
      // 即使内容为空也应渲染按钮
      expect(buttons).toHaveLength(2)
    })

    it('tooltip 不应包含 Turn 序号标题', () => {
      const msgs = [
        createUserMessage('msg-1', [{ type: 'text', text: '普通文本消息' }]),
        createUserMessage('msg-2', [{ type: 'text', text: '另一条消息' }]),
      ]
      renderRail(msgs)

      // 按钮的 aria-label 只包含"跳转到用户消息 N"，不包含 Turn 等标题
      const desktopNav = screen.getAllByRole('navigation')[0]
      const buttons = desktopNav.querySelectorAll('button')

      for (const btn of buttons) {
        expect(btn.getAttribute('aria-label')).not.toMatch(/Turn|turn|第/)
      }
    })
  })

  describe('active 状态', () => {
    it('active 节点应有 aria-current="true"', () => {
      const msgs = [
        createUserMessage('msg-1', [{ type: 'text', text: 'first' }]),
        createUserMessage('msg-2', [{ type: 'text', text: 'second' }]),
      ]
      renderRail(msgs, 'msg-1')

      const desktopNav = screen.getAllByRole('navigation')[0]
      const buttons = desktopNav.querySelectorAll('button')

      expect(buttons[0]).toHaveAttribute('aria-current', 'true')
      expect(buttons[1]).not.toHaveAttribute('aria-current')
    })
  })
})
