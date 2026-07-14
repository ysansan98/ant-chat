import { describe, expect, it } from 'vitest'
import { parseCliArgs } from '../cliOptions'

describe('parseCliArgs', () => {
  it('默认仅允许本机访问', () => {
    expect(parseCliArgs([])).toEqual({
      type: 'start',
      options: {
        host: '127.0.0.1',
        port: 3456,
      },
    })
  })

  it('通过布尔 host 参数允许局域网访问', () => {
    expect(parseCliArgs(['--host', '--port', '8080'])).toEqual({
      type: 'start',
      options: {
        host: '0.0.0.0',
        port: 8080,
      },
    })
  })

  it.each(['0', '65536', '1.5', 'abc', '-1'])('拒绝非法端口 %s', (port) => {
    expect(() => parseCliArgs([`--port=${port}`])).toThrow(`端口必须是 1 到 65535 之间的整数，收到：${port}`)
  })

  it('拒绝未知参数', () => {
    expect(() => parseCliArgs(['--unknown'])).toThrow('未知命令')
  })

  it('返回帮助和版本操作', () => {
    expect(parseCliArgs(['--help'])).toEqual({ type: 'help' })
    expect(parseCliArgs(['--version'])).toEqual({ type: 'version' })
  })

  it('将数据目录传给启动和控制命令', () => {
    expect(parseCliArgs(['start', '--data-dir=/tmp/ant-chat'])).toEqual({
      type: 'start',
      options: {
        dataDir: '/tmp/ant-chat',
        host: '127.0.0.1',
        port: 3456,
      },
    })
    expect(parseCliArgs(['settings', 'show', '--data-dir', '/tmp/ant-chat'])).toEqual({
      type: 'control',
      argv: ['settings', 'show'],
      options: { dataDir: '/tmp/ant-chat' },
    })
  })
})
