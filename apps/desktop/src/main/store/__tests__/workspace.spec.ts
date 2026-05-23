import { describe, expect, it } from 'vitest'
import { computeDisplayNames } from '../workspace'

describe('workspace display names', () => {
  it('同名目录从第一个不同上级目录开始展示', () => {
    const names = computeDisplayNames([
      '/tmp/test/demo',
      '/tmp/test1/demo',
      '/tmp/test1/a/b/demo',
      '/tmp/test2/a/b/demo',
      '/tmp/unique',
    ])

    expect(names).toEqual([
      'test/demo',
      'test1/demo',
      'test1/.../demo',
      'test2/.../demo',
      'unique',
    ])
  })
})
