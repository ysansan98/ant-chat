import { describe, expect, it } from 'vitest'
import { buildTurnInput } from '../buildTurnInput'

const testSettings = {
  modelId: 'model',
  providerId: 'provider',
  temperature: 0.2,
  maxOutputTokens: 2048,
}

describe('buildTurnInput', () => {
  it('完整保留普通消息启动 turn 所需参数', () => {
    expect(buildTurnInput({
      conversationId: 'conv-1',
      messageContent: [{ type: 'text', text: '继续实现' }],
      workspacePath: '/workspace',
      settings: testSettings,
      mode: 'hybrid',
    })).toEqual({
      conversationId: 'conv-1',
      messageContent: [{ type: 'text', text: '继续实现' }],
      workspacePath: '/workspace',
      mode: 'hybrid',
      modelConfig: {
        modelId: 'model',
        providerId: 'provider',
        temperature: 0.2,
        maxOutputTokens: 2048,
        reasoningEffort: undefined,
      },
      conversationInstructions: undefined,
    })
  })

  it('传递 conversationInstructions 到输出', () => {
    expect(buildTurnInput({
      messageContent: [{ type: 'text', text: 'hello' }],
      workspacePath: '/workspace',
      settings: testSettings,
      mode: 'hybrid',
      conversationInstructions: '请使用中文',
    })).toEqual({
      conversationId: undefined,
      messageContent: [{ type: 'text', text: 'hello' }],
      workspacePath: '/workspace',
      mode: 'hybrid',
      modelConfig: {
        modelId: 'model',
        providerId: 'provider',
        temperature: 0.2,
        maxOutputTokens: 2048,
        reasoningEffort: undefined,
      },
      conversationInstructions: '请使用中文',
    })
  })

  // ===== 契约测试：目标 DTO 结构 =====

  it('【契约】输出只包含 messageContent 和明确列出的 model config，无 prompt/content 双真源', () => {
    const result = buildTurnInput({
      conversationId: 'conv-1',
      messageContent: [{ type: 'text', text: '继续实现' }],
      workspacePath: '/workspace',
      settings: testSettings,
      mode: 'hybrid',
    })

    // 使用 messageContent 而非 prompt/content
    expect(result).toHaveProperty('messageContent')
    expect(result).not.toHaveProperty('prompt')
    expect(result).not.toHaveProperty('content')

    // 不应包含 referencedFiles / selectedSkill / features
    expect(result).not.toHaveProperty('referencedFiles')
    expect(result).not.toHaveProperty('selectedSkill')
    expect(result).not.toHaveProperty('features')

    // modelConfig 应明确列出字段
    expect(result.modelConfig).toEqual({
      modelId: 'model',
      providerId: 'provider',
      temperature: 0.2,
      maxOutputTokens: 2048,
      reasoningEffort: undefined,
    })
    expect(result.modelConfig).not.toHaveProperty('systemPrompt')
    expect(result.modelConfig).not.toHaveProperty('features')

    // conversationInstructions 与 modelConfig 平级
    expect(result).toHaveProperty('conversationInstructions')
  })

  it('【契约】无 systemPrompt 传递', () => {
    const result = buildTurnInput({
      conversationId: 'conv-1',
      messageContent: [{ type: 'text', text: '继续实现' }],
      workspacePath: '/workspace',
      settings: testSettings,
      mode: 'hybrid',
    })

    expect(result.modelConfig).not.toHaveProperty('systemPrompt')
    expect(result).not.toHaveProperty('systemPrompt')
  })
})
