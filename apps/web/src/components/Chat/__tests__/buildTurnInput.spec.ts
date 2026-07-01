import { describe, expect, it } from 'vitest'
import { buildTurnInput } from '../buildTurnInput'

describe('buildTurnInput', () => {
  it('完整保留普通消息启动 turn 所需参数', () => {
    expect(buildTurnInput({
      conversationId: 'conv-1',
      text: '继续实现',
      content: [{ type: 'text', text: '继续实现' }],
      referencedFiles: ['src/a.ts'],
      selectedSkill: 'review',
      workspacePath: '/workspace',
      settings: { modelId: 'model', providerId: 'provider', systemPrompt: 'system', temperature: 0.2, maxTokens: 2048 },
      features: { enableMCP: true },
      mode: 'hybrid',
    })).toEqual({
      conversationId: 'conv-1',
      prompt: '继续实现',
      content: [{ type: 'text', text: '继续实现' }],
      referencedFiles: ['src/a.ts'],
      selectedSkill: 'review',
      workspacePath: '/workspace',
      mode: 'hybrid',
      modelConfig: { modelId: 'model', providerId: 'provider', systemPrompt: 'system', temperature: 0.2, maxTokens: 2048, features: { enableMCP: true } },
    })
  })
})
