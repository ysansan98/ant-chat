import { describe, expect, it } from 'vitest'
import { detectFileLanguage } from '../fileLanguage'

describe('detectFileLanguage', () => {
  it('按扩展名识别常见语言', () => {
    expect(detectFileLanguage('src/index.ts')).toBe('typescript')
    expect(detectFileLanguage('App.tsx')).toBe('tsx')
    expect(detectFileLanguage('main.py')).toBe('python')
    expect(detectFileLanguage('package.json')).toBe('json')
    expect(detectFileLanguage('README.md')).toBe('markdown')
    expect(detectFileLanguage('run.sh')).toBe('bash')
  })

  it('识别无扩展名特例文件名', () => {
    expect(detectFileLanguage('Dockerfile')).toBe('dockerfile')
    expect(detectFileLanguage('Makefile')).toBe('makefile')
    expect(detectFileLanguage('docker/Dockerfile')).toBe('dockerfile')
  })

  it('未知扩展名与无扩展名回退 text', () => {
    expect(detectFileLanguage('LICENSE')).toBe('text')
    expect(detectFileLanguage('data.bin')).toBe('text')
    expect(detectFileLanguage('.env.local')).toBe('dotenv')
  })

  it('扩展名匹配不区分大小写', () => {
    expect(detectFileLanguage('README.MD')).toBe('markdown')
    expect(detectFileLanguage('App.TSX')).toBe('tsx')
  })
})
