import { describe, expect, it } from 'vitest'
import { mapModelsDevEffortToV7, ModelCapabilitiesSchema, ReasoningEffortSchema } from '../../schemas/providerConfigModels'

describe('mapModelsDevEffortToV7', () => {
  it('将 models.dev 的 effort 档位映射为 ai-sdk v7 档位（max → xhigh）', () => {
    expect(mapModelsDevEffortToV7(['none', 'low', 'medium', 'high', 'max']))
      .toEqual(['none', 'low', 'medium', 'high', 'xhigh'])
  })

  it('无 effort 选项或为空时返回 undefined', () => {
    expect(mapModelsDevEffortToV7(undefined)).toBeUndefined()
    expect(mapModelsDevEffortToV7([])).toBeUndefined()
  })

  it('丢弃 models.dev 中未知的档位', () => {
    expect(mapModelsDevEffortToV7(['low', 'bogus', 'high'])).toEqual(['low', 'high'])
  })
})

describe('model capabilities schema', () => {
  it('接受 reasoningLevels 字段', () => {
    const parsed = ModelCapabilitiesSchema.parse({ reasoning: true, reasoningLevels: ['low', 'high'] })
    expect(parsed.reasoningLevels).toEqual(['low', 'high'])
  })

  it('reasoningLevels 缺省时为 undefined', () => {
    const parsed = ModelCapabilitiesSchema.parse({ reasoning: true })
    expect(parsed.reasoningLevels).toBeUndefined()
  })

  it('outputModalities 接受 models.dev 的全部输出枚举（含 video/audio/pdf）', () => {
    const parsed = ModelCapabilitiesSchema.parse({
      outputModalities: ['text', 'image', 'video', 'audio', 'pdf'],
    })
    expect(parsed.outputModalities).toEqual(['text', 'image', 'video', 'audio', 'pdf'])
  })

  it('拒绝未知的输入/输出模态枚举', () => {
    expect(ModelCapabilitiesSchema.safeParse({ inputModalities: ['haptic'] }).success).toBe(false)
    expect(ModelCapabilitiesSchema.safeParse({ outputModalities: ['haptic'] }).success).toBe(false)
  })
})

describe('reasoning effort schema', () => {
  it('拒绝非法的档位值', () => {
    expect(ReasoningEffortSchema.safeParse('invalid').success).toBe(false)
    expect(ReasoningEffortSchema.safeParse('xhigh').success).toBe(true)
  })
})
