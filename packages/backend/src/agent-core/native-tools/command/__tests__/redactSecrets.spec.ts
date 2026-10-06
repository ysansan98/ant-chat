import { describe, expect, it } from 'vitest'
import { createStreamRedactor, redactSecrets } from '../redactSecrets'

describe('redactSecrets', () => {
  it('递归替换字符串中的密钥，长密钥优先', () => {
    const result = redactSecrets(
      { a: 'token=abc', list: ['abc', 'ab'], nested: { value: 'xabcy' } },
      ['ab', 'abc'],
    )
    expect(result).toEqual({
      a: 'token=[secret]',
      list: ['[secret]', '[secret]'],
      nested: { value: 'x[secret]y' },
    })
  })

  it('流式脱敏能处理被 chunk 撕裂的密钥', () => {
    const redactor = createStreamRedactor(['super-secret'])
    const output = redactor.write('token=super-') + redactor.write('secret\n') + redactor.flush()
    expect(output).toBe('token=[secret]\n')
    expect(output).not.toContain('super-secret')
  })

  it('普通文本不因等待密钥前缀而延迟输出', () => {
    const redactor = createStreamRedactor(['super-secret'])
    expect(redactor.write('build started\n')).toBe('build started\n')
  })

  it('无密钥时原样输出', () => {
    const redactor = createStreamRedactor([])
    expect(redactor.write('plain text')).toBe('plain text')
  })
})
