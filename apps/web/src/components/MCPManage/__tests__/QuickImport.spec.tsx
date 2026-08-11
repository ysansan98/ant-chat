import { describe, expect, it } from 'vitest'
import { parseMcpServerJsonText, splitCommandLine } from '../quickImportParser'

describe('splitCommandLine', () => {
  it('单个可执行文件不拆分参数', () => {
    expect(splitCommandLine('npx')).toEqual({ command: 'npx', args: [] })
  })

  it('拆出可执行文件与参数，URL 原样保留', () => {
    expect(splitCommandLine('npx -y mcp-remote https://mcp.tavily.com/mcp/?tavilyApiKey=key')).toEqual({
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.tavily.com/mcp/?tavilyApiKey=key'],
    })
  })

  it('支持单引号包裹的参数', () => {
    expect(splitCommandLine('uvx mypkg \'a b\'')).toEqual({ command: 'uvx', args: ['mypkg', 'a b'] })
  })

  it('支持双引号与转义', () => {
    expect(splitCommandLine('cmd "a\\"b" c')).toEqual({ command: 'cmd', args: ['a"b', 'c'] })
  })

  it('未闭合引号抛出可读错误，而不是静默保留整串', () => {
    expect(() => splitCommandLine('cmd "abc')).toThrow(/引号未闭合/)
  })
})

describe('parseMcpServerJsonText', () => {
  it('兼容 Claude Desktop 整串 command 格式，拆分为 command + args', () => {
    const result = parseMcpServerJsonText(JSON.stringify({
      mcpServers: {
        'tavily-remote-mcp': {
          command: 'npx -y mcp-remote https://mcp.tavily.com/mcp/?tavilyApiKey=key',
          env: {},
        },
      },
    }))

    expect(result).toMatchObject({
      serverName: 'tavily-remote-mcp',
      transportType: 'stdio',
      command: 'npx',
      args: ['-y', 'mcp-remote', 'https://mcp.tavily.com/mcp/?tavilyApiKey=key'],
      env: {},
    })
  })

  it('显式提供 args 时保留用户参数，不再用拆分结果覆盖', () => {
    const result = parseMcpServerJsonText(JSON.stringify({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/ant-chat'],
        },
      },
    }))

    expect(result).toMatchObject({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/ant-chat'],
    })
  })

  it('url 配置识别为 streamable-http，不触发 command 拆分', () => {
    const result = parseMcpServerJsonText(JSON.stringify({
      mcpServers: {
        tavily: {
          url: 'https://mcp.tavily.com/mcp/?tavilyApiKey=key',
        },
      },
    }))

    expect(result).toMatchObject({
      serverName: 'tavily',
      transportType: 'streamable-http',
      url: 'https://mcp.tavily.com/mcp/?tavilyApiKey=key',
    })
  })
})
