import { describe, expect, it } from 'vitest'
import { applyContextSnapshot, createContextSnapshot } from '../contextDelta'

describe('模型请求上下文 delta', () => {
  it('无损重建对象字段和数组的增删改与重排', () => {
    const baselineValue = { messages: ['a', 'b'], settings: { old: true, value: 1 } }
    const nextValue = { messages: ['b', 'c', 'a'], settings: { value: 2 }, added: 'yes' }
    const baseline = createContextSnapshot(undefined, baselineValue)
    const restoredBaseline = applyContextSnapshot(undefined, baseline)
    const delta = createContextSnapshot(restoredBaseline, nextValue)

    expect(applyContextSnapshot(restoredBaseline, delta)).toEqual(nextValue)
  })

  it('delta 前置 hash 不匹配时拒绝伪重建', () => {
    const delta = createContextSnapshot({ value: 1 }, { value: 2 })
    expect(() => applyContextSnapshot({ value: 3 }, delta)).toThrow('corrupt-delta')
  })
})
