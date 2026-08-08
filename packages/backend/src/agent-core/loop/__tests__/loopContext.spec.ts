import type { IMessage } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { buildConversationContextEntries, buildConversationContextMessages, createLoopSystemPrompt } from '../loopContext'

function textMessage(id: string, role: 'user' | 'assistant', text: string): IMessage {
  return {
    id,
    convId: 'conv-1',
    createdAt: 1,
    role,
    status: 'success',
    content: [{ type: 'text', text }],
  }
}

describe('buildConversationContextMessages 行为', () => {
  it('系统提示使用平台中立的命令工作目录说明', () => {
    const prompt = createLoopSystemPrompt('/workspace')

    expect(prompt).toContain('Commands already run in the workspace directory')
    expect(prompt).not.toContain('Bash commands already run')
  })

  it('替换到最近压缩边界为止的消息并保留后续消息', async () => {
    const messages = [
      textMessage('u1', 'user', 'old user'),
      textMessage('a1', 'assistant', 'old assistant'),
      textMessage('u2', 'user', 'kept user'),
      textMessage('a2', 'assistant', 'kept assistant'),
      {
        id: 'evt-1',
        convId: 'conv-1',
        createdAt: 1,
        role: 'event' as const,
        status: 'success' as const,
        eventType: 'compaction',
        compactedThroughMessageId: 'a1',
        content: [{ type: 'text' as const, text: 'event summary' }],
      },
      textMessage('current', 'user', 'current prompt'),
    ]

    const result = await buildConversationContextMessages(
      messages,
      'current',
    )

    expect(result).toEqual([
      {
        role: 'user',
        content: [{
          type: 'text',
          text: [
            'Previous conversation history has been compressed into the following summary:',
            '<summary>',
            'event summary',
            '</summary>',
            'Continue the task based on the above summary and subsequent conversation.',
          ].join('\n'),
        }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: 'kept user' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'kept assistant' }],
      },
    ])
  })

  it('只保留压缩边界后已持久化 assistant 消息的 usage', async () => {
    const messages: IMessage[] = [
      {
        ...textMessage('a1', 'assistant', 'old assistant'),
        usage: { totalTokens: 9000 },
      },
      {
        id: 'evt-1',
        convId: 'conv-1',
        createdAt: 2,
        role: 'event',
        status: 'success',
        eventType: 'compaction',
        compactedThroughMessageId: 'a1',
        content: [{ type: 'text', text: 'event summary' }],
      },
      textMessage('u2', 'user', 'kept user'),
      {
        ...textMessage('a2', 'assistant', 'kept assistant'),
        usage: { inputTokens: 600, outputTokens: 400 },
      },
    ]

    const result = await buildConversationContextEntries(messages)

    expect(result).toEqual([
      {
        sourceMessageId: 'a1',
        message: expect.objectContaining({ role: 'user' }),
      },
      {
        sourceMessageId: 'u2',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'kept user' }],
        },
        status: 'success',
      },
      {
        sourceMessageId: 'a2',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'kept assistant' }],
        },
        status: 'success',
        usage: { inputTokens: 600, outputTokens: 400 },
      },
    ])
  })

  it('拒绝没有摘要文本的 compaction event', async () => {
    await expect(buildConversationContextMessages(
      [
        textMessage('u1', 'user', 'old user'),
        {
          id: 'evt-1',
          convId: 'conv-1',
          createdAt: 1,
          role: 'event' as const,
          status: 'success' as const,
          eventType: 'compaction',
          compactedThroughMessageId: 'u1',
          content: [{ type: 'text' as const, text: '  ' }],
        },
      ],
      'current',
    )).rejects.toThrow('Compaction event missing summary text: evt-1')
  })

  it('拒绝缺失 compaction 边界消息', async () => {
    await expect(buildConversationContextMessages([
      {
        id: 'evt-1',
        convId: 'conv-1',
        createdAt: 1,
        role: 'event',
        status: 'success',
        eventType: 'compaction',
        compactedThroughMessageId: 'missing',
        content: [{ type: 'text', text: 'summary' }],
      },
    ])).rejects.toThrow('Compaction boundary message not found: missing')
  })

  it('中断的 tool-call 修复为失败 tool-result，无对应 tool-call 的孤儿 tool-result 仍过滤', async () => {
    const messages: IMessage[] = [
      {
        ...textMessage('a1', 'assistant', '准备执行'),
        content: [
          { type: 'text', text: '准备执行' },
          { type: 'tool-call', toolCallId: 'call-completed', toolName: 'read_file', args: { path: 'a.ts' }, executeState: 'completed' },
        ],
      },
      {
        id: 't1',
        convId: 'conv-1',
        createdAt: 2,
        role: 'tool',
        status: 'success',
        content: [{ type: 'tool-result', toolCallId: 'call-completed', toolName: 'read_file', result: 'ok', isError: false }],
      },
      {
        ...textMessage('a2', 'assistant', '正在滚动页面'),
        content: [
          { type: 'text', text: '正在滚动页面' },
          { type: 'tool-call', toolCallId: 'call-orphan', toolName: 'browser_eval', args: { expression: 'scroll()' }, executeState: 'executing' },
        ],
      },
      {
        id: 't2',
        convId: 'conv-1',
        createdAt: 3,
        role: 'tool',
        status: 'success',
        content: [{ type: 'tool-result', toolCallId: 'call-orphan-result', toolName: 'browser_eval', result: 'unpaired', isError: false }],
      },
      textMessage('u3', 'user', '继续'),
    ]

    const result = await buildConversationContextEntries(messages)

    expect(result.map(entry => entry.message)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '准备执行' },
          { type: 'tool-call', toolCallId: 'call-completed', toolName: 'read_file', args: { path: 'a.ts' } },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call-completed', toolName: 'read_file', result: 'ok', isError: false }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '正在滚动页面' },
          { type: 'tool-call', toolCallId: 'call-orphan', toolName: 'browser_eval', args: { expression: 'scroll()' } },
        ],
      },
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call-orphan',
          toolName: 'browser_eval',
          result: '工具执行被中断（进程退出），未返回结果。',
          isError: true,
        }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: '继续' }],
      },
    ])
  })
})
